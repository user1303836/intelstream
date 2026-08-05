from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, replace
from typing import Any, Never

from intelstream.hands.types import (
    ActionKind,
    DefensivePose,
    EngineSnapshot,
    Foul,
    FoulAction,
    Hand,
    InputCommand,
    MovementAction,
    Power,
    PunchAction,
    PunchClass,
    SemanticAction,
    Target,
)

PROTOCOL_VERSION = 2
MAX_FRAME_BYTES = 4096
MAX_ACTIONS_PER_INPUT = 4
MAX_SERVER_FRAME_BYTES = 65_536
MAX_SEQUENCE = 2_147_483_647
MAX_TICK_LAG = 300
MAX_TICK_LEAD = 90


class ProtocolError(ValueError):
    pass


def _reject_constant(value: str) -> Never:
    raise ProtocolError(f"non-finite number {value!r} is not allowed")


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ProtocolError(f"duplicate field {key!r}")
        result[key] = value
    return result


def _object(value: object, name: str) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ProtocolError(f"{name} must be an object")
    return value


def _exact_fields(value: dict[str, object], allowed: set[str], name: str) -> None:
    unknown = set(value) - allowed
    if unknown:
        raise ProtocolError(f"unknown {name} fields: {', '.join(sorted(unknown))}")


def _integer(value: object, name: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ProtocolError(f"{name} must be an integer")
    if not minimum <= value <= maximum:
        raise ProtocolError(f"{name} must be between {minimum} and {maximum}")
    return value


def _enum[T: str](enum_type: type[T], value: object, name: str) -> T:
    if not isinstance(value, str):
        raise ProtocolError(f"{name} must be a string")
    try:
        return enum_type(value)
    except ValueError as exc:
        raise ProtocolError(f"invalid {name}") from exc


def _client_action_id(action: dict[str, object]) -> str | None:
    raw = action.get("id")
    if raw is None:
        return None
    if not isinstance(raw, str) or not raw or len(raw) > 32:
        raise ProtocolError("invalid action id")
    if not all(
        character.isascii() and (character.isalnum() or character in "-_") for character in raw
    ):
        raise ProtocolError("invalid action id")
    return raw


def _parse_action(raw: object) -> SemanticAction:
    action = _object(raw, "action")
    kind = _enum(ActionKind, action.get("kind"), "action kind")
    if kind is ActionKind.PUNCH:
        _exact_fields(action, {"kind", "hand", "class", "target", "power", "id"}, "punch")
        return PunchAction(
            hand=_enum(Hand, action.get("hand"), "hand"),
            punch_class=_enum(PunchClass, action.get("class"), "punch class"),
            target=_enum(Target, action.get("target"), "target"),
            power=_enum(Power, action.get("power", Power.NORMAL.value), "power"),
            client_action_id=_client_action_id(action),
        )
    if kind is ActionKind.FOUL:
        _exact_fields(action, {"kind", "foul", "id"}, "foul")
        return FoulAction(
            foul=_enum(Foul, action.get("foul"), "foul"),
            client_action_id=_client_action_id(action),
        )

    _exact_fields(action, {"kind", "id"}, "action")
    return MovementAction(kind=kind, client_action_id=_client_action_id(action))


def parse_client_input(
    frame: str | bytes,
    *,
    last_sequence: int = -1,
    server_tick: int = 0,
) -> InputCommand:
    encoded = frame.encode() if isinstance(frame, str) else frame
    if len(encoded) > MAX_FRAME_BYTES:
        raise ProtocolError("input frame is too large")
    try:
        raw = json.loads(
            encoded,
            parse_constant=_reject_constant,
            object_pairs_hook=_unique_object,
        )
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ProtocolError("input frame is not valid JSON") from exc

    envelope = _object(raw, "envelope")
    _exact_fields(
        envelope,
        {"version", "type", "sequence", "client_tick", "move", "defense", "actions"},
        "input",
    )
    if envelope.get("version") != PROTOCOL_VERSION:
        raise ProtocolError("unsupported protocol version")
    if envelope.get("type") != "input":
        raise ProtocolError("unsupported client message type")

    sequence = _integer(envelope.get("sequence"), "sequence", 0, MAX_SEQUENCE)
    if sequence <= last_sequence:
        raise ProtocolError("stale input sequence")
    client_tick = _integer(envelope.get("client_tick"), "client_tick", 0, MAX_SEQUENCE)
    if client_tick < max(0, server_tick - MAX_TICK_LAG):
        raise ProtocolError("client tick is too old")
    if client_tick > server_tick + MAX_TICK_LEAD:
        raise ProtocolError("client tick is too far ahead")

    move = _object(envelope.get("move"), "move")
    _exact_fields(move, {"x", "y"}, "move")
    move_x = _integer(move.get("x"), "move.x", -1000, 1000)
    move_y = _integer(move.get("y"), "move.y", -1000, 1000)
    defense = _enum(DefensivePose, envelope.get("defense"), "defense")
    if defense not in (
        DefensivePose.NONE,
        DefensivePose.GUARD_HIGH,
        DefensivePose.GUARD_LOW,
    ):
        raise ProtocolError("held defense must be none, guard_high, or guard_low")

    actions_raw = envelope.get("actions")
    if not isinstance(actions_raw, list):
        raise ProtocolError("actions must be an array")
    if len(actions_raw) > MAX_ACTIONS_PER_INPUT:
        raise ProtocolError("too many actions")
    actions = tuple(_parse_action(action) for action in actions_raw)

    return InputCommand(
        sequence=sequence,
        client_tick=client_tick,
        move_x=move_x,
        move_y=move_y,
        defense=defense,
        actions=actions,
    )


def parse_ticket_ack(frame: str | bytes) -> str | None:
    encoded = frame.encode() if isinstance(frame, str) else frame
    if len(encoded) > MAX_FRAME_BYTES:
        raise ProtocolError("input frame is too large")
    try:
        raw = json.loads(
            encoded,
            parse_constant=_reject_constant,
            object_pairs_hook=_unique_object,
        )
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ProtocolError("input frame is not valid JSON") from exc
    envelope = _object(raw, "envelope")
    if envelope.get("type") != "ticket_ack":
        return None
    _exact_fields(envelope, {"version", "type", "refresh_id"}, "ticket acknowledgement")
    if envelope.get("version") != PROTOCOL_VERSION:
        raise ProtocolError("unsupported protocol version")
    refresh_id = envelope.get("refresh_id")
    if (
        not isinstance(refresh_id, str)
        or not 16 <= len(refresh_id) <= 128
        or any(character < " " or character == "\x7f" for character in refresh_id)
    ):
        raise ProtocolError("invalid ticket refresh identifier")
    return refresh_id


def _action_dict(action: SemanticAction) -> dict[str, object]:
    result: dict[str, object]
    if isinstance(action, PunchAction):
        result = {
            "kind": action.kind.value,
            "hand": action.hand.value,
            "class": action.punch_class.value,
            "target": action.target.value,
            "power": action.power.value,
        }
    elif isinstance(action, FoulAction):
        result = {"kind": action.kind.value, "foul": action.foul.value}
    else:
        result = {"kind": action.kind.value}
    if action.client_action_id is not None:
        result["id"] = action.client_action_id
    return result


def encode_client_input(command: InputCommand) -> str:
    return json.dumps(
        {
            "version": PROTOCOL_VERSION,
            "type": "input",
            "sequence": command.sequence,
            "client_tick": command.client_tick,
            "move": {"x": command.move_x, "y": command.move_y},
            "defense": command.defense.value,
            "actions": [_action_dict(action) for action in command.actions],
        },
        separators=(",", ":"),
        sort_keys=True,
    )


def _json_default(value: object) -> object:
    if hasattr(value, "value"):
        return value.value
    if isinstance(value, tuple):
        return list(value)
    raise TypeError(f"cannot serialize {type(value).__name__}")


def snapshot_for_viewer(snapshot: EngineSnapshot, viewer_id: str | None) -> EngineSnapshot:
    if viewer_id is not None and viewer_id not in {
        fighter.player_id for fighter in snapshot.fighters
    }:
        raise ProtocolError("viewer is not a match player")
    fighters = tuple(
        fighter
        if fighter.player_id == viewer_id
        else replace(
            fighter,
            queued_actions=0,
            get_up_prompt=None,
            get_up_meter=0,
            get_up_required=0,
            get_up_window_start_tick=0,
            get_up_window_end_tick=0,
        )
        for fighter in snapshot.fighters
    )
    events = tuple(
        event
        for event in snapshot.events
        if not (event.kind == "get_up_input" and event.actor_id != viewer_id)
    )
    redacted = replace(
        snapshot,
        fighters=(fighters[0], fighters[1]),
        events=events,
        checksum="",
    )
    redacted_checksum = hashlib.sha256(
        json.dumps(
            asdict(redacted),
            default=_json_default,
            separators=(",", ":"),
            sort_keys=True,
        ).encode()
    ).hexdigest()
    return replace(redacted, checksum=redacted_checksum)


def encode_snapshot(snapshot: EngineSnapshot, *, viewer_id: str | None) -> str:
    payload: dict[str, Any] = {
        "version": PROTOCOL_VERSION,
        "type": "snapshot",
        "payload": asdict(snapshot_for_viewer(snapshot, viewer_id)),
    }
    encoded = json.dumps(payload, default=_json_default, separators=(",", ":"), sort_keys=True)
    if len(encoded.encode()) > MAX_SERVER_FRAME_BYTES:
        raise ProtocolError("snapshot frame is too large")
    return encoded
