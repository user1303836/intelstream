from __future__ import annotations

from collections import Counter
from dataclasses import replace
from itertools import pairwise
from math import hypot

import pytest
from scripts.hands_balance import (
    HUMAN_REACTION_TICKS,
    Lag,
    LaggedPlayer,
    ScriptedHuman,
    bout_styles,
    make_player,
    play,
    style_matrix,
)

from intelstream.hands.cpu import (
    CPU_STYLES,
    PROFILES,
    CpuBrain,
    CpuLevel,
    _evades,
    _rope_room,
    cpu_player_id,
    cpu_style,
    styled_profile,
)
from intelstream.hands.engine import EVASION_TICKS, BoxingEngine, EngineConfig
from intelstream.hands.rules import (
    BLIND_SIDE_EYE_THRESHOLD,
    BODY_COLLAPSE_STAMINA,
    BODY_COLLAPSE_TRAUMA,
    COMPATIBLE_COMBO_CHAINS,
    PUNCH_RULES,
    poise_ceiling,
)
from intelstream.hands.types import (
    ActionKind,
    DefensivePose,
    FighterStyle,
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
    """Every dice roll succeeds and every reaction is the quickest, so a test sees the brain's best
    answer."""
    brain._roll = lambda _percent: True  # type: ignore[method-assign]
    brain.profile = replace(brain.profile, reaction_spread=0)
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


@pytest.mark.parametrize("level", list(CpuLevel))
def test_each_punch_is_noticed_after_a_reaction_of_its_own(level: CpuLevel) -> None:
    profile = PROFILES[level]
    delays = []
    for seed in range(24):
        engine = engine_at(150, seed=seed)
        engine.checksums = False
        # A worn-out puncher's straight is slow enough to answer after any reaction.
        engine.fighter("human").conditioning = 0
        brain = CpuBrain("cpu", "human", level, seed)
        brain._roll = lambda _percent: True  # type: ignore[method-assign]
        brain._attack = lambda *_args: None  # type: ignore[method-assign]
        throw(engine, PunchAction(Hand.RIGHT, PunchClass.STRAIGHT, Target.HEAD, Power.POWER))
        engine.step()
        attack = engine.fighter("human").attack
        assert attack is not None
        for _ in range(30):
            command = brain.decide(engine)
            assert command is not None
            if brain._read_attack is not None:
                delays.append(engine.tick - attack.start_tick)
                break
            engine.submit_input("cpu", command)
            engine.step()
    assert len(delays) == 24
    assert profile.reaction_ticks == min(delays)
    assert max(delays) == profile.reaction_ticks + profile.reaction_spread
    assert len(set(delays)) == profile.reaction_spread + 1


@pytest.mark.parametrize(
    ("action", "distance", "expected"),
    [
        (PunchAction(Hand.RIGHT, PunchClass.STRAIGHT, Target.HEAD, Power.POWER), 120, "slip_left"),
        (PunchAction(Hand.LEFT, PunchClass.HOOK, Target.HEAD, Power.POWER), 105, "weave"),
        (PunchAction(Hand.RIGHT, PunchClass.UPPERCUT, Target.HEAD), 95, "slip_left"),
        (PunchAction(Hand.RIGHT, PunchClass.STRAIGHT, Target.HEAD, Power.POWER), 160, "pull"),
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


def body_hook_outcome(
    style: FighterStyle, *, puncher_conditioning: int = 1000, perfect_roll: bool = False
) -> str:
    """How a champion who reads a power body hook 6 ticks after it starts, and fails or passes the
    perfect roll, meets it."""
    engine = engine_at(100)
    engine.checksums = False
    engine.fighter("cpu").style = style
    engine.fighter("human").conditioning = puncher_conditioning
    brain = CpuBrain("cpu", "human", CpuLevel.CHAMPION, 4, style)
    brain.profile = profile = replace(brain.profile, reaction_ticks=6, reaction_spread=0)
    assert profile.read_percent != profile.perfect_percent
    brain._roll = lambda percent: (
        percent == profile.read_percent
        or (  # type: ignore[method-assign]
            perfect_roll and percent == profile.perfect_percent
        )
    )
    brain._movement = lambda *_args: (0, 0)  # type: ignore[method-assign]
    brain._attack = lambda *_args: None  # type: ignore[method-assign]
    throw(engine, PunchAction(Hand.RIGHT, PunchClass.HOOK, Target.BODY, Power.POWER))
    for _ in range(40):
        command = brain.decide(engine)
        assert command is not None
        engine.submit_input("cpu", command)
        for event in engine.step().events:
            if event.kind in ("hit", "counter_hit", "block", "perfect_block"):
                return "hit" if event.kind == "counter_hit" else event.kind
    raise AssertionError("the hook never arrived")


@pytest.mark.parametrize("style", [FighterStyle.BALANCED, FighterStyle.COUNTER_PUNCHER])
def test_a_guard_raised_too_late_for_a_plain_block_is_only_a_parry_when_the_roll_says_so(
    style: FighterStyle,
) -> None:
    # A fresh puncher's hook, read 4 ticks before contact, leaves no time to raise a guard that is
    # not still fresh when it lands: without the perfect roll it gets through, not parried anyway.
    assert body_hook_outcome(style) == "hit"
    assert body_hook_outcome(style, perfect_roll=True) == "perfect_block"
    # A worn-out puncher is slow enough for an ordinary block.
    assert body_hook_outcome(style, puncher_conditioning=0) == "block"


def parry_share(
    level: CpuLevel, style: FighterStyle, *, perfect_percent: int | None = None, trials: int = 120
) -> float:
    """Share of power body hooks thrown at random moments that the computer parries, standing still."""
    parried = 0
    for trial in range(trials):
        engine = engine_at(100, seed=trial)
        engine.checksums = False
        engine.fighter("cpu").style = style
        brain = CpuBrain("cpu", "human", level, 1000 + trial, style)
        if perfect_percent is not None:
            brain.profile = replace(brain.profile, perfect_percent=perfect_percent)
        brain._movement = lambda *_args: (0, 0)  # type: ignore[method-assign]
        brain._attack = lambda *_args: None  # type: ignore[method-assign]
        brain._head_movement = lambda *_args: None  # type: ignore[method-assign]
        wait = 20 + trial % 40
        for tick in range(wait + 30):
            command = brain.decide(engine)
            if command is not None:
                engine.submit_input("cpu", command)
            if tick == wait:
                throw(engine, PunchAction(Hand.LEFT, PunchClass.HOOK, Target.BODY, Power.POWER))
            events = engine.step().events
            if any(event.kind == "perfect_block" for event in events):
                parried += 1
                break
            if any(event.kind in ("hit", "counter_hit", "block") for event in events):
                break
    return parried / trials


def test_how_often_the_computer_parries_follows_its_reads_and_its_perfect_blocks() -> None:
    """A guard raised late enough to parry is the perfect-block roll's to give, at every level."""
    for level, style in (
        (CpuLevel.CONTENDER, FighterStyle.BALANCED),
        (CpuLevel.CHAMPION, FighterStyle.BALANCED),
        (CpuLevel.CHAMPION, FighterStyle.COUNTER_PUNCHER),
    ):
        assert parry_share(level, style, perfect_percent=0) == 0
    champion = styled_profile(PROFILES[CpuLevel.CHAMPION], FighterStyle.COUNTER_PUNCHER)
    expected = champion.read_percent * champion.perfect_percent / 10_000
    share = parry_share(CpuLevel.CHAMPION, FighterStyle.COUNTER_PUNCHER)
    assert abs(share - expected) <= 0.1
    assert parry_share(CpuLevel.CONTENDER, FighterStyle.BALANCED) < share


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


def test_it_only_follows_up_with_the_full_price_of_the_next_punch_in_hand() -> None:
    """The engine charges a combination's next punch in full before its discount, so a follow-up
    queued on the discounted price waits out the recovery or comes as a slow arm punch."""
    engine = engine_at(100)
    engine.checksums = False
    brain = CpuBrain("cpu", "human", CpuLevel.CHAMPION, 9)
    cpu, human = engine.fighter("cpu"), engine.fighter("human")
    engine.submit_input(
        "cpu",
        InputCommand(
            1, engine.tick, actions=(PunchAction(Hand.LEFT, PunchClass.JAB, Target.HEAD),)
        ),
    )
    while cpu.attack is None or not cpu.attack.resolved:
        engine.step()
    assert cpu.attack.landed
    # The first follow-up on offer after a jab is the hook; make it a power hook to the body.
    brain._rng.randrange = lambda _stop: 0  # type: ignore[method-assign]
    brain._shaped = lambda action, _them, _power: replace(  # type: ignore[method-assign]
        action, target=Target.BODY, power=Power.POWER
    )
    price = brain._rule(
        PunchAction(Hand.RIGHT, PunchClass.HOOK, Target.BODY, Power.POWER)
    ).stamina_cost

    def follow_up(stamina: int) -> PunchAction | None:
        brain._followed_start = -1
        brain._combo_left = 1
        cpu.stamina = stamina
        return brain._follow_up(cpu, human, 100.0, False)

    assert follow_up(price * 90 // 100) is None
    assert follow_up(price - 1) is None
    hook = follow_up(price)
    assert hook is not None
    attack = cpu.attack
    engine.submit_input("cpu", InputCommand(2, engine.tick, actions=(hook,)))
    events = []
    while cpu.attack is attack:
        events.extend(engine.step().events)
    # Paid in full, it cuts the jab's recovery short at the cancel point and is no arm punch.
    assert engine.tick == attack.start_tick + attack.cancel_age
    assert not any(event.kind == "exhausted" for event in events)


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
        engine, brain = knocked_down(CpuLevel.ROOKIE, seed, head=1400)
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


def test_between_rounds_it_stays_put_and_only_talks_to_its_corner() -> None:
    engine = engine_at(120, rounds=2, round_ticks=5, rest_ticks=40)
    brain = always(CpuBrain("cpu", "human", CpuLevel.CHAMPION, 13))
    run(engine, brain, 5)
    assert engine.phase is MatchPhase.REST
    command = brain.decide(engine)
    assert command is not None
    assert (command.move_x, command.move_y) == (0, 0)
    assert [action.kind for action in command.actions] == [ActionKind.CORNER_BREATH]
    engine.complete_forfeit("human")
    assert brain.decide(engine) is None


def resting(cpu_trauma: dict[str, int]) -> tuple[BoxingEngine, CpuBrain]:
    engine = engine_at(120, rounds=3, round_ticks=5, rest_ticks=40)
    for name, value in cpu_trauma.items():
        setattr(engine.fighter("cpu").trauma, name, value)
    brain = always(CpuBrain("cpu", "human", CpuLevel.CHAMPION, 21))
    while engine.phase is not MatchPhase.REST:
        engine.step()
    return engine, brain


@pytest.mark.parametrize(
    ("trauma", "instruction"),
    [
        ({"left_cut": 450}, ActionKind.CORNER_CUT),
        ({"bleeding": 260}, ActionKind.CORNER_CUT),
        ({"right_eye": 560}, ActionKind.CORNER_SWELLING),
        ({"swelling": 480}, ActionKind.CORNER_SWELLING),
        ({}, ActionKind.CORNER_BREATH),
    ],
)
def test_its_corner_works_on_what_is_worst(trauma: dict[str, int], instruction: ActionKind) -> None:
    engine, brain = resting(trauma)
    command = brain.decide(engine)
    assert command is not None
    assert [action.kind for action in command.actions] == [instruction]


def test_it_gives_one_instruction_a_rest_and_one_again_the_next_rest() -> None:
    engine, brain = resting({})
    sent: list[ActionKind] = []
    rounds_seen = set()
    while engine.result is None and engine.round_number <= 3:
        command = brain.decide(engine)
        if command is not None:
            sent.extend(
                action.kind for action in command.actions if engine.phase is MatchPhase.REST
            )
            if engine.phase is MatchPhase.REST:
                rounds_seen.add(engine.round_number)
            engine.submit_input("cpu", command)
        engine.step()
        if engine.round_number == 3 and engine.phase is MatchPhase.FIGHT:
            break
    assert len(rounds_seen) == 2
    assert sent == [ActionKind.CORNER_BREATH, ActionKind.CORNER_BREATH]
    assert engine.fighter("cpu").corner_choice is None or engine.phase is MatchPhase.FIGHT


def test_a_corner_that_forgets_does_not_keep_asking_through_the_rest() -> None:
    engine, brain = resting({})
    rolls = iter([False])
    brain._roll = lambda _percent: next(rolls, True)  # type: ignore[method-assign]
    sent = []
    for _ in range(10):
        command = brain.decide(engine)
        assert command is not None
        sent.extend(command.actions)
        engine.submit_input("cpu", command)
        engine.step()
    assert sent == []


def test_a_forgetful_corner_sends_nothing() -> None:
    engine, brain = resting({})
    never(brain)
    command = brain.decide(engine)
    assert command is not None
    assert command.actions == ()


def test_it_cannot_read_a_punch_on_the_side_of_its_shut_eye() -> None:
    def answers(left_eye: int) -> list[ActionKind]:
        engine = engine_at(120)
        engine.fighter("cpu").trauma.left_eye = left_eye
        brain = always(CpuBrain("cpu", "human", CpuLevel.CHAMPION, 2))
        brain._movement = lambda *_args: (0, 0)  # type: ignore[method-assign]
        brain._attack = lambda *_args: None  # type: ignore[method-assign]
        throw(engine, PunchAction(Hand.RIGHT, PunchClass.STRAIGHT, Target.HEAD, Power.POWER))
        return kinds(run(engine, brain, 12))

    assert ActionKind.SLIP_LEFT in answers(0)
    assert not any(
        kind in (ActionKind.SLIP_LEFT, ActionKind.SLIP_RIGHT, ActionKind.PULL)
        for kind in answers(BLIND_SIDE_EYE_THRESHOLD)
    )


def test_it_works_the_side_of_the_opponents_shut_eye() -> None:
    def hook_hands(right_eye: int) -> Counter[Hand]:
        hands: Counter[Hand] = Counter()
        for seed in range(40):
            engine = engine_at(100, seed=seed)
            engine.fighter("human").trauma.right_eye = right_eye
            brain = CpuBrain("cpu", "human", CpuLevel.CHAMPION, seed)
            brain._tick = engine.tick
            action = brain._choose(engine.fighter("cpu"), engine.fighter("human"), 100, 0)
            if action.punch_class in (PunchClass.HOOK, PunchClass.UPPERCUT):
                hands[action.hand] += 1
        return hands

    shut = hook_hands(BLIND_SIDE_EYE_THRESHOLD)
    open_ = hook_hands(0)
    assert shut[Hand.LEFT] > shut[Hand.RIGHT]
    assert shut[Hand.LEFT] > open_[Hand.LEFT]


def test_it_keeps_power_back_from_a_guard_that_could_still_parry_it() -> None:
    engine = engine_at(110)
    brain = always(CpuBrain("cpu", "human", CpuLevel.CHAMPION, 41))
    human = engine.fighter("human")
    hook = PunchAction(Hand.LEFT, PunchClass.HOOK, Target.HEAD)
    brain._tick = engine.tick
    assert brain._shaped(hook, human, 100).power is Power.NORMAL
    human.defense = DefensivePose.GUARD_HIGH
    human.defense_started_tick = engine.tick - 30
    assert brain._shaped(hook, human, 100).power is Power.POWER
    human.defense_started_tick = engine.tick - 1
    assert brain._shaped(hook, human, 100).power is Power.NORMAL
    human.defense = DefensivePose.NONE
    human.stunned_ticks = 10
    assert brain._shaped(hook, human, 100).power is Power.POWER


def test_with_its_body_broken_down_it_keeps_more_stamina_back() -> None:
    engine = engine_at(110)
    brain = CpuBrain("cpu", "human", CpuLevel.ROOKIE, 42)
    cpu = engine.fighter("cpu")
    fresh = brain._reserve(cpu)
    cpu.trauma.body = BODY_COLLAPSE_TRAUMA
    assert fresh < BODY_COLLAPSE_STAMINA < brain._reserve(cpu)


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


def bout(
    one: CpuLevel, two: CpuLevel, seed: int, *, round_ticks: int = 90 * 30, checksums: bool = False
) -> BoxingEngine:
    engine = BoxingEngine(
        match_id="sim",
        activity_instance_id="instance",
        guild_id="guild",
        player_one_id="one",
        player_two_id="two",
        seed=seed,
        config=EngineConfig(rounds=1, round_ticks=round_ticks, countdown_ticks=0),
    )
    engine.checksums = checksums
    brains = (CpuBrain("one", "two", one, seed * 2), CpuBrain("two", "one", two, seed * 2 + 1))
    while engine.result is None:
        for brain in brains:
            command = brain.decide(engine)
            if command is not None:
                engine.submit_input(brain.player_id, command)
        engine.step()
    return engine


def test_a_bout_without_checksums_plays_out_the_same() -> None:
    hashed = bout(CpuLevel.CHAMPION, CpuLevel.CONTENDER, 8, round_ticks=600, checksums=True)
    fast = bout(CpuLevel.CHAMPION, CpuLevel.CONTENDER, 8, round_ticks=600)
    assert hashed.events == fast.events and hashed.result == fast.result
    assert hashed.snapshot().checksum and fast.snapshot().checksum == ""


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


def test_a_newcomer_mashing_every_punch_button_can_beat_the_rookie() -> None:
    """Never guarding and never stopping, he out-lands the rookie and is not stopped."""
    bouts = [
        play("mash", "rookie", seed, EngineConfig(rounds=1, countdown_ticks=0))
        for seed in range(1, 9)
    ]
    assert [bout.method for bout in bouts] == ["decision"] * 8
    assert sum(bout.winner_seat == 0 for bout in bouts) >= 5


def test_the_rookie_lands_punches_on_a_turtle_every_round_and_the_turtle_still_wins() -> None:
    """A newcomer who covers up still has to defend: the rookie pecks at his guard every round."""
    for seed in (1, 2, 3):
        bout = play("turtle", "rookie", seed, EngineConfig(), bout_styles("turtle", "rookie", seed))
        assert bout.winner_seat == 0
        assert bout.rounds == 3 and min(bout.landed_by_round[1]) >= 1


def test_a_rookie_pecks_at_a_guard_or_a_quiet_man_but_waits_out_a_busy_open_one() -> None:
    def leads(level: CpuLevel, defense: DefensivePose, *, busy: bool) -> bool:
        engine = engine_at(110)
        brain = always(CpuBrain("cpu", "human", level, 3))
        human = engine.fighter("human")
        human.defense = defense
        brain._opponent_punches = [engine.tick - 10] if busy else []
        punch = brain._attack(engine.tick, engine.fighter("cpu"), human, 110.0, False, False, False)
        # Leading is throwing now or stepping in to throw.
        return punch is not None or brain._step_in is not None

    assert leads(CpuLevel.ROOKIE, DefensivePose.GUARD_HIGH, busy=True)
    assert leads(CpuLevel.ROOKIE, DefensivePose.NONE, busy=False)
    assert not leads(CpuLevel.ROOKIE, DefensivePose.NONE, busy=True)
    assert leads(CpuLevel.CONTENDER, DefensivePose.NONE, busy=True)


def test_a_skilled_player_beats_the_rookie_on_the_cards_and_not_by_cutting_him_up() -> None:
    """Sixty-odd clean jabs on one eye used to split it open before the final bell in every bout."""
    bout = play("skilled", "rookie", 1, EngineConfig())
    assert (bout.winner_seat, bout.method) == (0, "decision")


def test_the_champion_can_be_outboxed_or_outcountered_but_not_mashed() -> None:
    """A skilled player and a counter-puncher each win some bouts against the champion and lose
    others; a button masher next to never wins."""
    config = EngineConfig()

    def winner(human: str, seed: int, style: FighterStyle) -> int | None:
        return play(human, "champion", seed, config, (FighterStyle.BALANCED, style)).winner_seat

    assert winner("skilled", 2, FighterStyle.COUNTER_PUNCHER) == 0
    assert winner("skilled", 2, FighterStyle.SWARMER) == 1
    assert winner("counter", 4, FighterStyle.BOXER) == 0
    assert winner("counter", 1, FighterStyle.SWARMER) == 1
    assert winner("mash", 1, FighterStyle.BOXER) == 1


def test_against_a_scripted_player_the_computer_boxes_in_its_room_style() -> None:
    assert bout_styles("skilled", "champion", 5) == (
        FighterStyle.BALANCED,
        cpu_style(CpuLevel.CHAMPION, 5),
    )
    assert bout_styles("champion", "rookie", 5) == (FighterStyle.BALANCED, FighterStyle.BALANCED)


def test_the_scripted_counter_puncher_minds_its_breath_guards_low_and_talks_to_its_corner() -> None:
    def wants_to_throw(stamina: int) -> set[PunchClass]:
        """What it would throw in range of a jab that has landed, given the breath it has."""
        engine = engine_at(140)
        engine.fighter("human").stamina = stamina
        counter = ScriptedHuman("counter", "human", "cpu")
        jab = PunchAction(Hand.LEFT, PunchClass.JAB, Target.HEAD)
        engine.submit_input("cpu", InputCommand(1, engine.tick, actions=(jab,)))
        wanted: set[PunchClass] = set()
        for _ in range(HUMAN_REACTION_TICKS + 4):
            engine.step()
            command = counter.decide(engine)
            assert command is not None
            wanted.update(punch.punch_class for punch in punches([command]))
        return wanted

    assert wants_to_throw(1000) == {PunchClass.JAB, PunchClass.STRAIGHT}
    assert wants_to_throw(200) == {PunchClass.STRAIGHT}
    assert wants_to_throw(60) == set()

    engine = engine_at(130)
    engine.fighter("human").stamina = 250
    body_hook = PunchAction(Hand.LEFT, PunchClass.HOOK, Target.BODY, Power.POWER)
    engine.submit_input("cpu", InputCommand(1, engine.tick, actions=(body_hook,)))
    for _ in range(HUMAN_REACTION_TICKS + 1):
        engine.step()
    attack = engine.fighter("cpu").attack
    assert attack is not None and not attack.resolved
    command = ScriptedHuman("counter", "human", "cpu").decide(engine)
    assert command is not None and command.defense is DefensivePose.GUARD_LOW

    engine.phase = MatchPhase.REST
    command = ScriptedHuman("counter", "human", "cpu").decide(engine)
    assert command is not None and kinds([command]) == [ActionKind.CORNER_BREATH]


def first_guard_tick(human: str, lag: Lag | None, seed: int) -> int:
    """Ticks from the start of a slow body hook to the first low guard the server hears for it.

    Thrown from across the ring, so nothing the human does on the way in can stop it first."""
    engine = engine_at(300, seed=seed)
    # Worn out, the puncher is slow enough that every reaction sees the hook before it lands.
    engine.fighter("cpu").conditioning = 0
    player = make_player(human, "human", "cpu", seed, lag=lag)
    hook = PunchAction(Hand.LEFT, PunchClass.HOOK, Target.BODY, Power.POWER)
    engine.submit_input("cpu", InputCommand(1, engine.tick, actions=(hook,)))
    started = engine.tick + 1
    for _ in range(30):
        command = player.decide(engine)
        if command is not None:
            engine.submit_input("human", command)
            if command.defense is DefensivePose.GUARD_LOW:
                return engine.tick + 1 - started
        engine.step()
    raise AssertionError("the hook was never guarded")


@pytest.mark.parametrize("human", ["skilled", "counter"])
def test_a_scripted_human_on_a_connection_sees_each_punch_late_and_is_heard_late(
    human: str,
) -> None:
    assert {first_guard_tick(human, None, seed) for seed in range(6)} == {HUMAN_REACTION_TICKS + 1}
    lag = Lag(reaction=(6, 9), latency_ticks=2, uplink_ticks=1)
    delays = {first_guard_tick(human, lag, seed) for seed in range(12)}
    # His reaction to each punch is his own, then the connection shows it late and carries the
    # guard back late: the server hears it between 6+2+1 and 9+2+1 ticks after the punch starts.
    assert delays <= set(range(6 + 2 + 1 + 1, 9 + 2 + 1 + 2))
    assert len(delays) >= 3


def test_a_lagged_player_delivers_every_command_in_order_and_late() -> None:
    class Counting:
        def __init__(self) -> None:
            self.sequence = 0

        def decide(self, engine: BoxingEngine) -> InputCommand:
            self.sequence += 1
            return InputCommand(self.sequence, engine.tick)

    engine = engine_at(150)
    lagged = LaggedPlayer(Counting(), 2)
    heard = [lagged.decide(engine) for _ in range(5)]
    assert [None if command is None else command.sequence for command in heard] == [
        None,
        None,
        1,
        2,
        3,
    ]
    assert Lag.over(50, (6, 9)) == Lag((6, 9), 1, 1)
    assert Lag.over(100, (6, 9)) == Lag((6, 9), 2, 2)


def test_a_style_matrix_plays_two_strategies_with_each_style_on_each_side() -> None:
    config = EngineConfig(rounds=1, round_ticks=240, countdown_ticks=0)
    table = style_matrix(
        "skilled:brawler",
        [FighterStyle.BALANCED, FighterStyle.SWARMER],
        range(101, 102),
        config,
        Lag(reaction=(6, 9), uplink_ticks=1),
    )
    assert table.splitlines()[0].startswith("skilled:brawler: win % of the row's style")
    assert "2 bouts a pair, seeds 101-101" in table
    assert "+-" in table.splitlines()[2]


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


def _fight_a_man_standing_still(level: CpuLevel, prepare, ticks: int = 900) -> Counter[str]:  # type: ignore[no-untyped-def]
    """The computer against an opponent who stands in front of it and never punches."""
    engine = engine_at(220, seed=5, round_ticks=100_000)
    brain = CpuBrain("cpu", "human", level, 5)
    seen: Counter[str] = Counter()
    for sequence in range(1, ticks + 1):
        cpu, human = engine.fighter("cpu"), engine.fighter("human")
        prepare(cpu)
        human.poise, human.stamina, human.guard = 600, 1000, 700
        command = brain.decide(engine)
        if command is not None:
            engine.submit_input("cpu", command)
        engine.submit_input("human", InputCommand(sequence, engine.tick))
        for event in engine.step().events:
            if event.actor_id == "cpu":
                seen[event.kind] += 1
    return seen


@pytest.mark.parametrize("level", [CpuLevel.CONTENDER, CpuLevel.CHAMPION])
def test_a_battered_computer_at_the_poise_it_can_still_have_keeps_fighting(level: CpuLevel) -> None:
    def battered(cpu) -> None:  # type: ignore[no-untyped-def]
        cpu.trauma.head = 1200
        cpu.poise = poise_ceiling(1200)

    seen = _fight_a_man_standing_still(level, battered)
    assert seen["punch_start"] >= 20


@pytest.mark.parametrize("level", [CpuLevel.CONTENDER, CpuLevel.CHAMPION])
def test_a_computer_whose_body_is_broken_down_fights_on_the_breath_it_can_still_hold(
    level: CpuLevel,
) -> None:
    """Saving stamina against a body knockdown must not ask for more than a battered body holds."""

    def broken_down(cpu) -> None:  # type: ignore[no-untyped-def]
        cpu.trauma.body = 800
        cpu.conditioning = 100

    # Gassed, with a third of his breath, he still throws a punch every few seconds (none before).
    seen = _fight_a_man_standing_still(level, broken_down)
    assert seen["punch_start"] >= 8
    for level_ in CpuLevel:
        brain = CpuBrain("cpu", "human", level_, 1)
        cpu = engine_at(110).fighter("cpu")
        for body in range(0, 1201, 100):
            for conditioning in range(0, 1001, 100):
                cpu.trauma.body, cpu.conditioning = body, conditioning
                assert brain._reserve(cpu) < cpu.maximum_stamina


@pytest.mark.parametrize("level", [CpuLevel.CONTENDER, CpuLevel.CHAMPION])
def test_with_swollen_eyes_it_steps_into_its_shorter_reach(level: CpuLevel) -> None:
    def swollen(cpu) -> None:  # type: ignore[no-untyped-def]
        cpu.trauma.left_eye = cpu.trauma.right_eye = 800
        cpu.trauma.swelling = 700

    seen = _fight_a_man_standing_still(level, swollen)
    assert seen["punch_start"] >= 20
    assert seen["whiff"] * 10 <= seen["punch_start"]


def test_the_computer_picks_its_style_from_the_match_seed() -> None:
    for level in CpuLevel:
        picks = {cpu_style(level, seed) for seed in range(200)}
        assert picks == set(CPU_STYLES[level])
        assert cpu_style(level, 99) is cpu_style(level, 99)


@pytest.mark.parametrize("level", list(CpuLevel))
def test_each_style_boxes_its_own_way(level: CpuLevel) -> None:
    base = PROFILES[level]
    assert styled_profile(base, FighterStyle.BALANCED) == base
    boxer = styled_profile(base, FighterStyle.BOXER)
    assert boxer.outside_distance > base.outside_distance
    assert boxer.jab_bias > base.jab_bias
    slugger = styled_profile(base, FighterStyle.SLUGGER)
    assert slugger.power_percent > base.power_percent
    assert slugger.footwork_percent < base.footwork_percent
    swarmer = styled_profile(base, FighterStyle.SWARMER)
    assert swarmer.outside_distance < base.outside_distance
    assert swarmer.body_percent > base.body_percent
    assert swarmer.aggression_percent > base.aggression_percent
    assert swarmer.head_movement_percent > base.head_movement_percent
    counter = styled_profile(base, FighterStyle.COUNTER_PUNCHER)
    assert counter.counter_percent > base.counter_percent
    assert counter.aggression_percent < base.aggression_percent
    for styled in (boxer, slugger, swarmer, counter):
        for name in ("aggression_percent", "power_percent", "counter_percent", "body_percent"):
            assert 0 <= getattr(styled, name) <= 100


def test_it_prices_and_times_its_punches_by_its_style() -> None:
    engine = engine_at(120)
    cpu = engine.fighter("cpu")
    hook = PunchAction(Hand.LEFT, PunchClass.HOOK, Target.HEAD, Power.POWER)
    cost = PUNCH_RULES[(PunchClass.HOOK, Target.HEAD, Power.POWER)].stamina_cost
    cpu.stamina = cost
    balanced = CpuBrain("cpu", "human", CpuLevel.CHAMPION, 6)
    slugger = CpuBrain("cpu", "human", CpuLevel.CHAMPION, 6, FighterStyle.SLUGGER)
    assert balanced._affordable(cpu, hook, 0)
    assert not slugger._affordable(cpu, hook, 0)
    swarmer = CpuBrain("cpu", "human", CpuLevel.CHAMPION, 6, FighterStyle.SWARMER)
    assert swarmer._timing(cpu, hook)[0] == balanced._timing(cpu, hook)[0] - 1
    jab = PunchAction(Hand.LEFT, PunchClass.JAB, Target.HEAD)
    boxer = CpuBrain("cpu", "human", CpuLevel.CHAMPION, 6, FighterStyle.BOXER)
    assert boxer._rule(jab).reach > balanced._rule(jab).reach


def test_a_counter_puncher_raises_its_guard_earlier_for_the_perfect_block() -> None:
    def guard_from(style: FighterStyle) -> int:
        engine = engine_at(120)
        brain = always(CpuBrain("cpu", "human", CpuLevel.CHAMPION, 6, style))
        throw(engine, PunchAction(Hand.RIGHT, PunchClass.STRAIGHT, Target.HEAD, Power.POWER))
        engine.step()
        human = engine.fighter("human")
        cpu = engine.fighter("cpu")
        attack = human.attack
        assert attack is not None
        # Force a guard answer: an evasion is out of reach.
        cpu.stamina = 0
        while engine.tick - attack.start_tick < brain.profile.reaction_ticks:
            engine.step()
        brain._read(engine.tick, cpu, human)
        return brain._guard_from

    assert guard_from(FighterStyle.COUNTER_PUNCHER) == guard_from(FighterStyle.BALANCED) - 1


def test_the_brain_boxes_in_the_style_it_is_given() -> None:
    for style in FighterStyle:
        brain = CpuBrain("cpu", "human", CpuLevel.CONTENDER, 1, style)
        assert brain.profile == styled_profile(PROFILES[CpuLevel.CONTENDER], style)
        assert (brain.profile == PROFILES[CpuLevel.CONTENDER]) is (style is FighterStyle.BALANCED)


def test_a_counter_puncher_still_slips_a_slow_punch_it_reads_early() -> None:
    def answer(style: FighterStyle) -> ActionKind | None:
        engine = engine_at(120)
        human = engine.fighter("human")
        # A worn-out puncher is slow enough that the punch is read long before it lands.
        human.conditioning = 0
        brain = always(CpuBrain("cpu", "human", CpuLevel.CHAMPION, 2, style))
        throw(engine, PunchAction(Hand.RIGHT, PunchClass.STRAIGHT, Target.HEAD, Power.POWER))
        engine.step()
        attack = human.attack
        assert attack is not None
        while attack.start_tick + attack.rule.startup - engine.tick > EVASION_TICKS + 1:
            engine.step()
        return brain._read(engine.tick, engine.fighter("cpu"), human)

    assert answer(FighterStyle.BALANCED) is None
    assert answer(FighterStyle.COUNTER_PUNCHER) is ActionKind.SLIP_LEFT
