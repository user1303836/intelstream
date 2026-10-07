import json

import pytest

from intelstream.hands.cpu import CpuLevel
from intelstream.hands.engine import BoxingEngine, EngineConfig
from intelstream.hands.protocol import (
    MAX_ACTIONS_PER_INPUT,
    MAX_FRAME_BYTES,
    MAX_TICK_LAG,
    MAX_TICK_LEAD,
    ProtocolError,
    StyleChoice,
    decode_client_frame,
    encode_client_input,
    encode_snapshot,
    parse_client_input,
    parse_cpu_request,
    parse_style_choice,
    parse_ticket_ack,
    snapshot_for_viewer,
)
from intelstream.hands.types import (
    ActionKind,
    DefensivePose,
    FighterStyle,
    Foul,
    FoulAction,
    Hand,
    InputCommand,
    MovementAction,
    Power,
    PunchAction,
    PunchClass,
    Target,
)


def test_round_trip_every_semantic_action() -> None:
    actions = [
        PunchAction(hand, punch_class, target, power)
        for hand in Hand
        for punch_class in PunchClass
        for target in Target
        for power in Power
    ]
    actions.extend(
        MovementAction(kind)
        for kind in ActionKind
        if kind not in (ActionKind.PUNCH, ActionKind.FOUL)
    )
    actions.extend(FoulAction(foul) for foul in Foul)

    for sequence, action in enumerate(actions, start=1):
        command = InputCommand(
            sequence=sequence,
            client_tick=20,
            move_x=-700,
            move_y=500,
            defense=DefensivePose.GUARD_HIGH,
            actions=(action,),
        )
        assert parse_client_input(encode_client_input(command), server_tick=20) == command


def valid_payload() -> dict[str, object]:
    return {
        "version": 3,
        "type": "input",
        "sequence": 2,
        "client_tick": 10,
        "move": {"x": 0, "y": 0},
        "defense": "none",
        "actions": [],
    }


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("version",), 1),
        (("type",), "result"),
        (("sequence",), -1),
        (("client_tick",), -1),
        (("move", "x"), 1001),
        (("move", "y"), -1001),
        (("defense",), "slip_left"),
    ],
)
def test_rejects_invalid_envelope_values(path: tuple[str, ...], value: object) -> None:
    payload = valid_payload()
    current: dict[str, object] = payload
    for key in path[:-1]:
        nested = current[key]
        assert isinstance(nested, dict)
        current = nested
    current[path[-1]] = value

    with pytest.raises(ProtocolError):
        parse_client_input(json.dumps(payload), server_tick=10)


@pytest.mark.parametrize("forbidden", ["user_id", "winner_id", "result", "damage", "elo"])
def test_rejects_identity_and_result_fields(forbidden: str) -> None:
    payload = valid_payload()
    payload[forbidden] = "forged"

    with pytest.raises(ProtocolError, match="unknown input fields"):
        parse_client_input(json.dumps(payload), server_tick=10)


def test_rejects_unknown_nested_fields_and_malformed_actions() -> None:
    payload = valid_payload()
    payload["move"] = {"x": 0, "y": 0, "z": 1}
    with pytest.raises(ProtocolError, match="unknown move fields"):
        parse_client_input(json.dumps(payload), server_tick=10)

    payload = valid_payload()
    payload["actions"] = [{"kind": "punch", "hand": "left"}]
    with pytest.raises(ProtocolError):
        parse_client_input(json.dumps(payload), server_tick=10)

    payload = valid_payload()
    payload["actions"] = [{"kind": "teleport"}]
    with pytest.raises(ProtocolError, match="invalid action kind"):
        parse_client_input(json.dumps(payload), server_tick=10)


def test_rejects_duplicate_fields() -> None:
    frame = (
        '{"version":3,"type":"input","sequence":1,"sequence":2,'
        '"client_tick":1,"move":{"x":0,"y":0},"defense":"none","actions":[]}'
    )

    with pytest.raises(ProtocolError, match="duplicate field"):
        parse_client_input(frame, server_tick=1)


def test_rejects_non_finite_and_non_integer_numbers() -> None:
    payload = valid_payload()
    payload["move"] = {"x": float("nan"), "y": 0}
    with pytest.raises(ProtocolError, match="non-finite"):
        parse_client_input(json.dumps(payload), server_tick=10)

    payload = valid_payload()
    payload["sequence"] = 2.0
    with pytest.raises(ProtocolError, match="integer"):
        parse_client_input(json.dumps(payload), server_tick=10)


def test_rejects_stale_sequences_but_clamps_implausible_ticks() -> None:
    frame = json.dumps(valid_payload())
    with pytest.raises(ProtocolError, match="stale"):
        parse_client_input(frame, last_sequence=2, server_tick=10)

    payload = valid_payload()
    payload["client_tick"] = 500
    ahead = parse_client_input(json.dumps(payload), server_tick=10)
    assert ahead.client_tick == 10 + MAX_TICK_LEAD

    payload["client_tick"] = 1
    stalled = parse_client_input(json.dumps(payload), server_tick=500)
    assert stalled.client_tick == 500 - MAX_TICK_LAG


def test_rejects_oversized_frames_and_action_arrays() -> None:
    with pytest.raises(ProtocolError, match="too large"):
        parse_client_input(b" " * (MAX_FRAME_BYTES + 1))

    payload = valid_payload()
    payload["actions"] = [{"kind": "switch_stance"} for _ in range(MAX_ACTIONS_PER_INPUT + 1)]
    with pytest.raises(ProtocolError, match="too many"):
        parse_client_input(json.dumps(payload), server_tick=10)


@pytest.mark.parametrize("frame", ["", "[]", "null", "{", b"\xff"])
def test_rejects_malformed_frames(frame: str | bytes) -> None:
    with pytest.raises(ProtocolError):
        parse_client_input(frame)


def test_ticket_ack_is_strict_and_distinct_from_semantic_input() -> None:
    frame = '{"version":3,"type":"ticket_ack","refresh_id":"refresh-identifier"}'
    assert parse_ticket_ack(frame) == "refresh-identifier"
    assert parse_ticket_ack(json.dumps(valid_payload())) is None
    for malformed in (
        '{"version":3,"type":"ticket_ack","refresh_id":"short"}',
        '{"version":3,"type":"ticket_ack","refresh_id":"refresh-identifier","extra":1}',
        '{"version":3,"type":"ticket_ack","refresh_id":"one","refresh_id":"two"}',
    ):
        with pytest.raises(ProtocolError):
            parse_ticket_ack(malformed)


def test_computer_request_is_strict_and_distinct_from_other_frames() -> None:
    for level in CpuLevel:
        frame = json.dumps({"version": 3, "type": "cpu", "level": level.value})
        assert parse_cpu_request(frame) is level
    assert parse_cpu_request(json.dumps(valid_payload())) is None
    assert parse_cpu_request('{"version":3,"type":"ticket_ack","refresh_id":"refresh-id"}') is None
    for malformed in (
        '{"version":3,"type":"cpu","level":"legend"}',
        '{"version":3,"type":"cpu"}',
        '{"version":3,"type":"cpu","level":1}',
        '{"version":3,"type":"cpu","level":"rookie","extra":1}',
        '{"version":2,"type":"cpu","level":"rookie"}',
        '{"version":3,"type":"cpu","level":"rookie","level":"champion"}',
        "not json",
        "x" * (MAX_FRAME_BYTES + 1),
    ):
        with pytest.raises(ProtocolError):
            parse_cpu_request(malformed)


def test_style_choice_is_strict_and_distinct_from_other_frames() -> None:
    for style in FighterStyle:
        for ready in (True, False):
            frame = json.dumps(
                {"version": 3, "type": "style", "style": style.value, "ready": ready}
            )
            assert parse_style_choice(frame) == StyleChoice(style, ready)
    assert parse_style_choice(json.dumps(valid_payload())) is None
    assert parse_style_choice('{"version":3,"type":"cpu","level":"rookie"}') is None
    for malformed in (
        '{"version":3,"type":"style","style":"brawler","ready":true}',
        '{"version":3,"type":"style","style":"boxer"}',
        '{"version":3,"type":"style","style":"boxer","ready":1}',
        '{"version":3,"type":"style","style":"boxer","ready":"yes"}',
        '{"version":3,"type":"style","style":"boxer","ready":true,"extra":1}',
        '{"version":2,"type":"style","style":"boxer","ready":true}',
        '{"version":3,"type":"style","style":"boxer","style":"slugger","ready":true}',
        '{"version":3,"type":"style","style":5,"ready":true}',
        "not json",
        "x" * (MAX_FRAME_BYTES + 1),
    ):
        with pytest.raises(ProtocolError):
            parse_style_choice(malformed)


def test_snapshot_encoding_is_required_and_redacted_per_viewer() -> None:
    engine = BoxingEngine(
        match_id="match",
        activity_instance_id="instance",
        guild_id="guild",
        player_one_id="one",
        player_two_id="two",
        seed=7,
        config=EngineConfig(round_ticks=100, countdown_ticks=0),
    )
    one = engine.fighter("one")
    two = engine.fighter("two")
    one.pending_actions.append(MovementAction(ActionKind.CLINCH))
    one.clinch_startup_ticks = 4
    one.clinch_ticks = 12
    engine._foul_recovery_target = "one"
    one.get_up_prompt = ActionKind.GET_UP_LEFT
    one.get_up_meter = 31
    one.get_up_window_start_tick = 12
    one.get_up_window_end_tick = 18
    two.pending_actions.append(MovementAction(ActionKind.SWITCH_STANCE))
    two.get_up_prompt = ActionKind.GET_UP_RIGHT
    two.get_up_meter = 27
    two.get_up_window_start_tick = 20
    two.get_up_window_end_tick = 26
    engine._emit("get_up_input", "two", amount=12, detail="timed")
    snapshot = engine.snapshot()

    one_payload = json.loads(encode_snapshot(snapshot, viewer_id="one"))["payload"]
    two_payload = json.loads(encode_snapshot(snapshot, viewer_id="two"))["payload"]
    spectator_payload = json.loads(encode_snapshot(snapshot, viewer_id=None))["payload"]
    one_view = {fighter["player_id"]: fighter for fighter in one_payload["fighters"]}
    two_view = {fighter["player_id"]: fighter for fighter in two_payload["fighters"]}
    spectator_view = {fighter["player_id"]: fighter for fighter in spectator_payload["fighters"]}

    assert one_view["one"]["queued_actions"] == 1
    assert one_view["one"]["clinch_startup_ticks"] == 4
    assert one_view["one"]["clinch_ticks"] == 12
    assert one_view["one"]["is_foul_recovery_target"] is True
    assert one_view["one"]["is_downed"] is False
    assert one_view["one"]["get_up_prompt"] == "get_up_left"
    assert one_view["one"]["get_up_meter"] == 31
    assert one_view["two"]["queued_actions"] == 0
    assert one_view["two"]["get_up_prompt"] is None
    assert one_view["two"]["get_up_meter"] == 0
    assert one_view["two"]["get_up_required"] == 0
    assert one_view["two"]["get_up_window_start_tick"] == 0
    assert two_view["two"]["queued_actions"] == 1
    assert two_view["two"]["get_up_prompt"] == "get_up_right"
    assert two_view["one"]["queued_actions"] == 0
    assert two_view["one"]["get_up_prompt"] is None
    assert one_payload["events"] == []
    assert two_payload["events"][0]["kind"] == "get_up_input"
    assert two_payload["events"][0]["detail"] == "timed"
    assert spectator_view["one"]["queued_actions"] == 0
    assert spectator_view["two"]["queued_actions"] == 0
    assert spectator_view["one"]["get_up_prompt"] is None
    assert spectator_view["two"]["get_up_prompt"] is None
    assert spectator_view["one"]["get_up_meter"] == 0
    assert spectator_view["two"]["get_up_meter"] == 0
    assert spectator_payload["events"] == []
    assert one_payload["checksum"] != snapshot.checksum
    assert two_payload["checksum"] != snapshot.checksum
    assert spectator_payload["checksum"] != snapshot.checksum
    assert one_payload["checksum"] != two_payload["checksum"]
    assert spectator_payload["checksum"] not in {
        one_payload["checksum"],
        two_payload["checksum"],
    }

    with pytest.raises(ProtocolError, match="not a match player"):
        snapshot_for_viewer(snapshot, "unknown-player")
    with pytest.raises(TypeError):
        encode_snapshot(snapshot)


def test_client_action_id_validated_and_round_trips() -> None:
    payload = valid_payload()
    payload["actions"] = [
        {
            "kind": "punch",
            "hand": "left",
            "class": "jab",
            "target": "head",
            "power": "normal",
            "id": "c17",
        }
    ]
    command = parse_client_input(json.dumps(payload), server_tick=10)
    action = command.actions[0]
    assert isinstance(action, PunchAction)
    assert action.client_action_id == "c17"
    encoded = encode_client_input(command)
    reparsed = parse_client_input(encoded, server_tick=11)
    assert isinstance(reparsed.actions[0], PunchAction)
    assert reparsed.actions[0].client_action_id == "c17"

    for bad in ["has space", "emoji\xe9", "x" * 33, ""]:
        payload = valid_payload()
        payload["actions"] = [
            {"kind": "punch", "hand": "left", "class": "jab", "target": "head", "id": bad}
        ]
        with pytest.raises(ProtocolError, match="action id"):
            parse_client_input(json.dumps(payload), server_tick=10)


def test_corner_instructions_and_choice_travel_on_the_wire() -> None:
    payload = valid_payload()
    payload["actions"] = [{"kind": "corner_cut"}, {"kind": "corner_swelling", "id": "rest-1"}]
    command = parse_client_input(json.dumps(payload))
    assert command.actions == (
        MovementAction(ActionKind.CORNER_CUT),
        MovementAction(ActionKind.CORNER_SWELLING, client_action_id="rest-1"),
    )

    engine = BoxingEngine(
        match_id="match-1",
        activity_instance_id="instance-1",
        guild_id="guild-1",
        player_one_id="one",
        player_two_id="two",
        seed=3,
        config=EngineConfig(round_ticks=5, rounds=2, rest_ticks=30, countdown_ticks=0),
    )
    fresh = json.loads(encode_snapshot(engine.snapshot(), viewer_id=None))["payload"]
    assert [fighter["corner_choice"] for fighter in fresh["fighters"]] == [None, None]
    while engine.phase.value != "rest":
        engine.step()
    engine.step({"two": InputCommand(1, 0, actions=(MovementAction(ActionKind.CORNER_BREATH),))})
    resting = json.loads(encode_snapshot(engine.snapshot(), viewer_id="one"))["payload"]
    assert [fighter["corner_choice"] for fighter in resting["fighters"]] == [None, "breath"]


def test_a_frame_is_decoded_once_and_then_read_as_whichever_message_it_is() -> None:
    request = decode_client_frame(json.dumps({"version": 3, "type": "cpu", "level": "rookie"}))
    assert parse_ticket_ack(request) is None
    assert parse_cpu_request(request) is CpuLevel.ROOKIE
    assert parse_style_choice(request) is None
    pick = decode_client_frame(
        json.dumps({"version": 3, "type": "style", "style": "slugger", "ready": True})
    )
    assert parse_cpu_request(pick) is None
    assert parse_style_choice(pick) == StyleChoice(FighterStyle.SLUGGER, True)
    frame = encode_client_input(InputCommand(sequence=4, client_tick=0, move_x=500))
    envelope = decode_client_frame(frame)
    assert parse_style_choice(envelope) is None
    command = parse_client_input(envelope, last_sequence=3)
    assert command.sequence == 4 and command.move_x == 500
    for bad in ("x" * (MAX_FRAME_BYTES + 1), "[1, 2]", "{", b"\xff\xfe"):
        with pytest.raises(ProtocolError):
            decode_client_frame(bad)
