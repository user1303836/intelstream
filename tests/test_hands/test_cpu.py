from __future__ import annotations

from collections import Counter
from dataclasses import replace
from itertools import pairwise
from math import hypot

import pytest

from intelstream.hands.cpu import (
    PROFILES,
    CpuBrain,
    CpuLevel,
    _evades,
    _rope_room,
    cpu_player_id,
)
from intelstream.hands.engine import BoxingEngine, EngineConfig
from intelstream.hands.rules import COMPATIBLE_COMBO_CHAINS, PUNCH_RULES
from intelstream.hands.types import (
    ActionKind,
    DefensivePose,
    Hand,
    InputCommand,
    MatchPhase,
    MovementAction,
    Power,
    PunchAction,
    PunchClass,
    Target,
)


def engine_at(distance: int, *, seed: int = 3, **config: int) -> BoxingEngine:
    engine = BoxingEngine(
        match_id="match",
        activity_instance_id="instance",
        guild_id="guild",
        player_one_id="human",
        player_two_id="cpu",
        seed=seed,
        config=EngineConfig(countdown_ticks=0, flash_ko_enabled=False, **config),
    )
    engine.fighter("human").x = -(distance // 2)
    engine.fighter("cpu").x = distance - distance // 2
    return engine


def always(brain: CpuBrain) -> CpuBrain:
    """Every dice roll succeeds, so a test sees the brain's best answer."""
    brain._roll = lambda _percent: True  # type: ignore[method-assign]
    return brain


def never(brain: CpuBrain) -> CpuBrain:
    brain._roll = lambda _percent: False  # type: ignore[method-assign]
    return brain


def throw(engine: BoxingEngine, action: PunchAction, sequence: int = 1) -> None:
    engine.submit_input("human", InputCommand(sequence, engine.tick, actions=(action,)))


def run(engine: BoxingEngine, brain: CpuBrain, ticks: int) -> list[InputCommand]:
    commands: list[InputCommand] = []
    for _ in range(ticks):
        command = brain.decide(engine)
        if command is not None:
            commands.append(command)
            engine.submit_input(brain.player_id, command)
        engine.step()
    return commands


def punches(commands: list[InputCommand]) -> list[PunchAction]:
    return [
        action
        for command in commands
        for action in command.actions
        if isinstance(action, PunchAction)
    ]


def kinds(commands: list[InputCommand]) -> list[ActionKind]:
    return [action.kind for command in commands for action in command.actions]


@pytest.mark.parametrize("punch_class", list(PunchClass))
@pytest.mark.parametrize("hand", list(Hand))
@pytest.mark.parametrize("target", list(Target))
@pytest.mark.parametrize("distance", [100, 140])
def test_the_evasion_it_picks_is_one_the_engine_accepts(
    punch_class: PunchClass, hand: Hand, target: Target, distance: int
) -> None:
    action = PunchAction(hand, punch_class, target)
    rule = PUNCH_RULES[(punch_class, target, Power.NORMAL)]
    pose = _evades(action, rule, distance, 0)
    engine = engine_at(distance)
    defender = engine.fighter("cpu")
    if pose is None:
        for candidate in (
            DefensivePose.SLIP_LEFT,
            DefensivePose.SLIP_RIGHT,
            DefensivePose.WEAVE,
            DefensivePose.PULL,
        ):
            defender.defense = candidate
            defender.evasion_ticks = 5
            assert not engine._evades(defender, action, distance * distance, rule.reach, 0)
        return
    defender.defense = pose
    defender.evasion_ticks = 5
    assert engine._evades(defender, action, distance * distance, rule.reach, 0)


def test_a_punch_is_not_answered_before_the_reaction_delay() -> None:
    engine = engine_at(150)
    brain = always(CpuBrain("cpu", "human", CpuLevel.CHAMPION, 1))
    brain._attack = lambda *_args: None  # type: ignore[method-assign]
    throw(engine, PunchAction(Hand.RIGHT, PunchClass.STRAIGHT, Target.HEAD, Power.POWER))
    engine.step()
    started = engine.fighter("human").attack
    assert started is not None
    answered_at = None
    for _ in range(12):
        command = brain.decide(engine)
        assert command is not None
        if command.actions:
            answered_at = engine.tick
            break
        engine.submit_input("cpu", command)
        engine.step()
    assert answered_at == started.start_tick + PROFILES[CpuLevel.CHAMPION].reaction_ticks


@pytest.mark.parametrize(
    ("action", "distance", "expected"),
    [
        (PunchAction(Hand.RIGHT, PunchClass.STRAIGHT, Target.HEAD, Power.POWER), 120, "slip_left"),
        (PunchAction(Hand.LEFT, PunchClass.HOOK, Target.HEAD, Power.POWER), 105, "weave"),
        (PunchAction(Hand.RIGHT, PunchClass.UPPERCUT, Target.HEAD), 95, "slip_left"),
        (PunchAction(Hand.RIGHT, PunchClass.STRAIGHT, Target.HEAD), 160, "pull"),
    ],
)
def test_a_champion_evades_a_punch_it_has_seen(
    action: PunchAction, distance: int, expected: str
) -> None:
    engine = engine_at(distance)
    brain = always(CpuBrain("cpu", "human", CpuLevel.CHAMPION, 2))
    # Standing still with its hands down, so the punch arrives where it was aimed.
    brain._movement = lambda *_args: (0, 0)  # type: ignore[method-assign]
    brain._attack = lambda *_args: None  # type: ignore[method-assign]
    throw(engine, action)
    evaded = False
    sent: list[ActionKind] = []
    for _ in range(25):
        command = brain.decide(engine)
        assert command is not None
        sent.extend(item.kind for item in command.actions)
        engine.submit_input("cpu", command)
        snapshot = engine.step()
        evaded = evaded or any(
            event.kind == "evade" and event.actor_id == "cpu" for event in snapshot.events
        )
        if evaded:
            break
    assert sent[0].value == expected
    assert evaded


def test_a_body_hook_it_cannot_duck_is_met_with_a_perfect_low_block() -> None:
    engine = engine_at(100)
    brain = always(CpuBrain("cpu", "human", CpuLevel.CHAMPION, 4))
    brain._movement = lambda *_args: (0, 0)  # type: ignore[method-assign]
    brain._attack = lambda *_args: None  # type: ignore[method-assign]
    throw(engine, PunchAction(Hand.RIGHT, PunchClass.HOOK, Target.BODY, Power.POWER))
    events: list[str] = []
    for _ in range(20):
        command = brain.decide(engine)
        assert command is not None
        assert not any(isinstance(item, MovementAction) for item in command.actions)
        engine.submit_input("cpu", command)
        events.extend(event.kind for event in engine.step().events if event.actor_id == "cpu")
        if "perfect_block" in events:
            break
    assert "perfect_block" in events


def test_a_misread_punch_gets_no_answer() -> None:
    engine = engine_at(120)
    brain = never(CpuBrain("cpu", "human", CpuLevel.CHAMPION, 5))
    brain._movement = lambda *_args: (0, 0)  # type: ignore[method-assign]
    throw(engine, PunchAction(Hand.RIGHT, PunchClass.STRAIGHT, Target.HEAD, Power.POWER))
    landed = []
    for _ in range(14):
        command = brain.decide(engine)
        assert command is not None
        assert command.actions == ()
        engine.submit_input("cpu", command)
        landed.extend(event.kind for event in engine.step().events if event.target_id == "cpu")
    assert "hit" in landed


def test_it_never_throws_a_punch_it_cannot_pay_for() -> None:
    engine = engine_at(120)
    brain = always(CpuBrain("cpu", "human", CpuLevel.CHAMPION, 6))
    # No reserve, so it is not resting: only the price of each punch holds it back.
    brain.profile = replace(brain.profile, stamina_reserve=0)
    cpu = engine.fighter("cpu")
    thrown: list[PunchAction] = []
    for _ in range(120):
        cpu.stamina = 40
        command = brain.decide(engine)
        assert command is not None
        thrown.extend(punches([command]))
        engine.submit_input("cpu", command)
        engine.step()
    assert all(
        PUNCH_RULES[(punch.punch_class, punch.target, punch.power)].stamina_cost <= 40
        for punch in thrown
    )
    assert not any(event.kind == "exhausted" for event in engine.events)


def test_with_stamina_in_hand_it_lets_its_hands_go() -> None:
    engine = engine_at(120)
    brain = always(CpuBrain("cpu", "human", CpuLevel.CHAMPION, 6))
    commands = run(engine, brain, 120)
    assert punches(commands)


@pytest.mark.parametrize("distance", [150, 165])
def test_it_only_throws_what_reaches(distance: int) -> None:
    engine = engine_at(distance)
    brain = always(CpuBrain("cpu", "human", CpuLevel.CHAMPION, 7))
    human = engine.fighter("human")
    for _ in range(60):
        command = brain.decide(engine)
        assert command is not None
        for punch in punches([command]):
            gap = hypot(human.x - engine.fighter("cpu").x, human.y - engine.fighter("cpu").y)
            assert PUNCH_RULES[(punch.punch_class, punch.target, punch.power)].reach >= gap
        engine.submit_input("cpu", command)
        engine.step()


def test_it_walks_toward_an_opponent_out_of_range_and_backs_off_one_too_close() -> None:
    far = engine_at(360)
    brain = never(CpuBrain("cpu", "human", CpuLevel.CONTENDER, 8))
    command = brain.decide(far)
    assert command is not None and command.move_x < 0
    close = engine_at(90)
    brain = never(CpuBrain("cpu", "human", CpuLevel.CONTENDER, 8))
    command = brain.decide(close)
    assert command is not None and command.move_x > 0


def rope_room_after(level: CpuLevel, ticks: int) -> float:
    engine = engine_at(150)
    human = engine.fighter("human")
    cpu = engine.fighter("cpu")
    human.x, human.y = 300, 0
    cpu.x, cpu.y = 450, 0
    brain = CpuBrain("cpu", "human", level, 9)
    brain._attack = lambda *_args: None  # type: ignore[method-assign]
    run(engine, brain, ticks)
    return _rope_room(cpu.x, cpu.y)


def test_off_the_ropes_a_champion_circles_out_and_a_rookie_is_slow_to() -> None:
    assert _rope_room(450, 0) < 15
    champion = rope_room_after(CpuLevel.CHAMPION, 60)
    rookie = rope_room_after(CpuLevel.ROOKIE, 60)
    assert champion > 80
    assert rookie < champion / 2


def test_hurt_and_close_it_ties_him_up() -> None:
    engine = engine_at(100)
    brain = always(CpuBrain("cpu", "human", CpuLevel.CONTENDER, 10))
    engine.fighter("cpu").poise = 80
    commands = run(engine, brain, 20)
    assert ActionKind.CLINCH in kinds(commands)
    assert any(event.kind == "clinch_start" for event in engine.events)


def test_fresh_it_does_not_clinch() -> None:
    engine = engine_at(100)
    brain = always(CpuBrain("cpu", "human", CpuLevel.CONTENDER, 10))
    assert ActionKind.CLINCH not in kinds(run(engine, brain, 90))


def knocked_down(level: CpuLevel, seed: int, *, head: int = 0) -> tuple[BoxingEngine, CpuBrain]:
    engine = engine_at(120, seed=seed)
    cpu = engine.fighter("cpu")
    cpu.trauma.head = head
    engine._knock_down(cpu, engine.fighter("human"))
    assert engine.phase is MatchPhase.KNOCKDOWN
    return engine, CpuBrain("cpu", "human", level, seed)


def test_down_it_answers_each_prompt_once_inside_its_window() -> None:
    engine, brain = knocked_down(CpuLevel.CHAMPION, 11)
    always(brain)
    cpu = engine.fighter("cpu")
    presses: list[tuple[int, ActionKind, int, int, ActionKind | None]] = []
    while engine.phase is MatchPhase.KNOCKDOWN:
        command = brain.decide(engine)
        assert command is not None
        for action in command.actions:
            presses.append(
                (
                    engine.tick + 1,
                    action.kind,
                    cpu.get_up_window_start_tick,
                    cpu.get_up_window_end_tick,
                    cpu.get_up_prompt,
                )
            )
        engine.submit_input("cpu", command)
        engine.step()
    assert presses
    for tick, kind, start, end, prompt in presses:
        assert start <= tick <= end
        assert kind is prompt
    assert len({start for _tick, _kind, start, _end, _prompt in presses}) == len(presses)
    assert engine.phase is MatchPhase.FIGHT
    assert any(event.kind == "get_up" and event.actor_id == "cpu" for event in engine.events)


def test_a_badly_hurt_rookie_can_stay_down() -> None:
    outcomes = Counter()
    for seed in range(12):
        engine, brain = knocked_down(CpuLevel.ROOKIE, seed, head=1300)
        engine.fighter("cpu").knockdowns = 2
        while engine.phase is MatchPhase.KNOCKDOWN:
            command = brain.decide(engine)
            if command is not None:
                engine.submit_input("cpu", command)
            engine.step()
        outcomes["up" if engine.result is None else "out"] += 1
    assert outcomes["out"] >= 6


def test_the_standing_fighter_sends_nothing_during_the_count() -> None:
    engine = engine_at(120)
    engine._knock_down(engine.fighter("human"), engine.fighter("cpu"))
    brain = always(CpuBrain("cpu", "human", CpuLevel.CHAMPION, 12))
    for _ in range(30):
        command = brain.decide(engine)
        assert command is not None and command.actions == ()
        engine.submit_input("cpu", command)
        engine.step()


def test_between_rounds_and_after_the_bout_it_is_still() -> None:
    engine = engine_at(120, rounds=2, round_ticks=5, rest_ticks=40)
    brain = always(CpuBrain("cpu", "human", CpuLevel.CHAMPION, 13))
    run(engine, brain, 6)
    assert engine.phase is MatchPhase.REST
    command = brain.decide(engine)
    assert command is not None
    assert (command.move_x, command.move_y, command.actions) == (0, 0, ())
    engine.complete_forfeit("human")
    assert brain.decide(engine) is None


def test_it_never_fouls() -> None:
    engine = engine_at(110)
    brain = CpuBrain("cpu", "human", CpuLevel.ROOKIE, 14)
    assert not any(kind is ActionKind.FOUL for kind in kinds(run(engine, brain, 900)))


def test_the_same_seed_plays_the_same_bout() -> None:
    def play(seed: int) -> list[InputCommand]:
        engine = engine_at(200)
        return run(engine, CpuBrain("cpu", "human", CpuLevel.CONTENDER, seed), 300)

    assert play(21) == play(21)
    assert play(21) != play(22)


def test_every_command_is_valid_input() -> None:
    engine = engine_at(130)
    commands = run(engine, CpuBrain("cpu", "human", CpuLevel.CHAMPION, 15), 600)
    sequences = [command.sequence for command in commands]
    assert sequences == sorted(set(sequences))
    for command in commands:
        assert command.move_x**2 + command.move_y**2 <= 1_000_000 + 2_000
        assert len(command.actions) <= 1
        assert command.defense in (
            DefensivePose.NONE,
            DefensivePose.GUARD_HIGH,
            DefensivePose.GUARD_LOW,
        )


def bout(one: CpuLevel, two: CpuLevel, seed: int) -> BoxingEngine:
    engine = BoxingEngine(
        match_id="sim",
        activity_instance_id="instance",
        guild_id="guild",
        player_one_id="one",
        player_two_id="two",
        seed=seed,
        config=EngineConfig(rounds=1, round_ticks=90 * 30, countdown_ticks=0),
    )
    brains = (CpuBrain("one", "two", one, seed * 2), CpuBrain("two", "one", two, seed * 2 + 1))
    while engine.result is None:
        for brain in brains:
            command = brain.decide(engine)
            if command is not None:
                engine.submit_input(brain.player_id, command)
        engine.step()
    return engine


@pytest.mark.parametrize("level", list(CpuLevel))
def test_two_computers_box_a_round_to_a_result(level: CpuLevel) -> None:
    engine = bout(level, level, 31)
    assert engine.result is not None
    landed = Counter(
        event.actor_id for event in engine.events if event.kind in ("hit", "counter_hit")
    )
    assert landed["one"] > 0 and landed["two"] > 0


def test_a_champion_beats_a_rookie() -> None:
    winners = Counter(
        bout(CpuLevel.CHAMPION, CpuLevel.ROOKIE, seed).result.winner_id for seed in range(5)
    )  # type: ignore[union-attr]
    assert winners["one"] >= 4


def test_profiles_get_better_with_the_level() -> None:
    rookie, contender, champion = (PROFILES[level] for level in CpuLevel)
    assert rookie.reaction_ticks > contender.reaction_ticks > champion.reaction_ticks
    assert rookie.read_percent < contender.read_percent < champion.read_percent
    assert rookie.rating < contender.rating < champion.rating
    assert cpu_player_id(CpuLevel.CHAMPION) == "cpu:champion"


def test_a_landed_punch_is_followed_by_a_combination_that_chains() -> None:
    engine = engine_at(110)
    brain = always(CpuBrain("cpu", "human", CpuLevel.CHAMPION, 16))
    started: list[tuple[int, PunchClass, int]] = []
    for _ in range(240):
        command = brain.decide(engine)
        assert command is not None
        engine.submit_input("cpu", command)
        snapshot = engine.step()
        attack = engine.fighter("cpu").attack
        if attack is not None and any(
            event.kind == "punch_start" and event.actor_id == "cpu" for event in snapshot.events
        ):
            started.append((attack.start_tick, attack.action.punch_class, attack.total_ticks))
    # A punch that starts before the one before it has recovered was a follow-up cut in early.
    follow_ups = [
        (before[1], after[1])
        for before, after in pairwise(started)
        if after[0] < before[0] + before[2]
    ]
    assert follow_ups
    assert all(pair in COMPATIBLE_COMBO_CHAINS for pair in follow_ups)


def test_a_rookie_lets_a_hurt_man_off_and_a_champion_does_not() -> None:
    def gap_after_landing(level: CpuLevel) -> int:
        engine = engine_at(110)
        brain = always(CpuBrain("cpu", "human", level, 17))
        brain.profile = replace(brain.profile, combo_length=1)
        starts = []
        for _ in range(240):
            command = brain.decide(engine)
            assert command is not None
            engine.submit_input("cpu", command)
            snapshot = engine.step()
            starts.extend(
                event.tick
                for event in snapshot.events
                if event.kind == "punch_start" and event.actor_id == "cpu"
            )
            if len(starts) >= 2:
                break
        return starts[1] - starts[0]

    rookie = PROFILES[CpuLevel.ROOKIE]
    assert gap_after_landing(CpuLevel.ROOKIE) >= rookie.admire_ticks
    assert gap_after_landing(CpuLevel.CHAMPION) < rookie.admire_ticks


def test_against_a_busy_opponent_it_moves_its_head() -> None:
    engine = engine_at(140)
    brain = always(CpuBrain("cpu", "human", CpuLevel.CHAMPION, 18))
    brain._attack = lambda *_args: None  # type: ignore[method-assign]
    brain._opponent_punches = [0, 1]
    command = brain.decide(engine)
    assert command is not None
    assert [action.kind for action in command.actions] in (
        [ActionKind.SLIP_LEFT],
        [ActionKind.SLIP_RIGHT],
        [ActionKind.WEAVE],
    )
    quiet = engine_at(140)
    brain = always(CpuBrain("cpu", "human", CpuLevel.CHAMPION, 18))
    brain._attack = lambda *_args: None  # type: ignore[method-assign]
    command = brain.decide(quiet)
    assert command is not None and command.actions == ()


def test_well_ahead_and_out_of_range_it_may_showboat_but_never_up_close() -> None:
    far = engine_at(300)
    far.fighter("human").knockdowns = 1
    brain = always(CpuBrain("cpu", "human", CpuLevel.ROOKIE, 19))
    command = brain.decide(far)
    assert command is not None and [action.kind for action in command.actions] == [ActionKind.TAUNT]
    close = engine_at(120)
    close.fighter("human").knockdowns = 1
    brain = always(CpuBrain("cpu", "human", CpuLevel.ROOKIE, 19))
    assert ActionKind.TAUNT not in kinds(run(close, brain, 60))


def test_a_high_guard_is_attacked_to_the_body() -> None:
    engine = engine_at(110)
    brain = always(CpuBrain("cpu", "human", CpuLevel.CONTENDER, 20))
    human = engine.fighter("human")
    thrown: list[PunchAction] = []
    for sequence in range(1, 120):
        engine.submit_input(
            "human", InputCommand(sequence, engine.tick, defense=DefensivePose.GUARD_HIGH)
        )
        command = brain.decide(engine)
        assert command is not None
        thrown.extend(punches([command]))
        engine.submit_input("cpu", command)
        engine.step()
        assert human.defense in (DefensivePose.GUARD_HIGH, DefensivePose.NONE)
    assert thrown
    assert all(punch.target is Target.BODY for punch in thrown)
