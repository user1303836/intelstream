# Hands combat-timing architectural report

Date: 2026-08-05. Author: lead gameplay animation engineer (pi). Scope: one normal
left jab (plus the golden exchange) through the full pipeline, measured end-to-end
with the deterministic replay, the `/hands/lab` harness, and rendered filmstrips.
No unit-test inference: every number below comes from the engine replay or the
rendered lab.

## Evidence inventory

- `scripts/hands_replay.py` — deterministic replay generator (seed 20260805).
  `uv run python scripts/hands_replay.py --check` must print identical sha256.
- `web/hands/replays/golden.json` — 161-tick golden replay
  (sha256 `84daee10ef2db96a7449a388b4cb234587abbd68b96aff0e16beca72163fa68f`).
  Markers: jab_1 submit t71, jab_2 submit t99, straight submit t113, knockdown t120.
- `/hands/lab` (dev-only route; `?lab=1` under vite dev) — pause, tick step,
  slow motion, fixed cameras (broadcast/side/top/ringside), skeleton/hurtbox/
  hitbox overlays, latency simulation, metric export, filmstrip mode
  (`&tick=N&camera=ringside`).
- Filmstrips (SwiftShader headless Chromium): `/tmp/hands-visual/filmstrip-jab/tick-*.png`
  (t69..t81) and `/tmp/hands-visual/filmstrip-straight/tick-*.png` (t114..t126).
- Lab metric export (render-free path): contacts, root step, foot slide.

## Stage-by-stage trace of one normal left jab (keyboard F)

1. **KeyboardInput** (`web/hands/src/input/keyboard.ts`): `keydown` F →
   `event.repeat` dropped, `preventDefault`, punch object
   `{kind:"punch", hand:"left", class:"jab", target: shift?"body":"head", power: alt?"power":"normal"}`
   → `SharedActionIntent.push("keyboard", action)`.
2. **SharedActionIntent** (`input/action-buffer.ts`): newest-intent buffer
   (maximum 1). Identical consecutive intent coalesces (source/timestamp update
   only). Different intent replaces the queued one immediately.
3. **NetworkController transmission** (`network.ts`): `setInterval(40ms)` →
   `flushInput()` → `sendInput(frame)` guards: role fighter, active phase, socket
   OPEN → `encodeInput(nextSequence++, serverTick, frame)` → websocket text frame.
4. **Websocket ingestion** (`server.py` `_websocket` loop): frame size-capped,
   JSON parsed, per-connection semaphore, decoded to `InputCommand`, routed to the
   connection's room.
5. **HandsRoom.submit_frame** (`rooms.py:550`): admission/ownership checks,
   forwarded to the match's engine instance; game tickets one-use; replay rejected
   by sequence (`command.sequence <= last_sequence` drops).
6. **BoxingEngine.submit_input** (`engine.py:335`): held movement/defense updated;
   actions deduplicated against the previous action in the same frame, truncated to
   `MAX_PENDING_ACTIONS`, expiry set to `tick + ACTION_BUFFER_TICKS (6)`;
   guard-transition clears pending intent.
7. **Attack lifecycle** (`engine.py` `_process_fighter`/`_start_punch`): pending
   action popped next tick → `AttackState` created, `punch_start` event emitted the
   same tick → `age` advances per tick → at `startup <= age < startup+active` and
   unresolved → `_resolve_punch` (authoritative hit test) → recovery until
   `age >= startup+active+recovery` → attack cleared. Stun clears immediately.
8. **Snapshot generation and broadcast**: per-tick `EngineSnapshot` (fighters,
   events, checksum) encoded per viewer (fighter vs spectator redaction), sent over
   each room websocket in the same tick.
9. **SnapshotBuffer sampling** (`interpolation.ts`): client keeps the last 6
   snapshots and samples at `latest.tick - 1` — a fixed one-tick look-behind —
   lerping x/y/velocity/facing between the two bracketing snapshots. Phase changes
   or knockdown-count changes snap to the newer snapshot (no blend).
10. **BoxerAnimator visual playback** (`render/animation.ts`): detects
    `fighter.action !== activeAction`, starts a self-paced local timeline
    (`PUNCH_DURATION`), drives IK gloves/body; `push()` maps combat events to
    recoil/hitstop (`landedHit`), effects, and audio.

## Input-to-photon latency budget (loopback; add RTT for remote)

| Stage | Min | Typical | Notes |
| --- | --- | --- | --- |
| keydown → flush (40 ms interval) | 0 ms | 20 ms | worst 40 ms |
| encode + ws send (loopback) | ~0.5 ms | ~1 ms | + RTT/2 upstream in prod |
| server tick quantization | 0 ms | 16.7 ms | engine runs fixed 30 Hz |
| engine startup (jab, fresh) | 3 ticks | 100 ms | `startup=max(2, 4*100/fatigue-1)` |
| resolve (contact) after start | +1 tick | 133 ms total | resolve at age == startup |
| snapshot → client decode | ~1 ms | ~1 ms | + RTT/2 downstream in prod |
| SnapshotBuffer look-behind | 33.3 ms | 33.3 ms | fixed `latest - 1` |
| RAF present (60 fps) | 0 ms | 8.3 ms | |
| **input → punch_start visible** | **~75 ms** | **~180 ms** | + RTT in prod |
| **input → visual contact (anim curve)** | **~190 ms** | **~290 ms** | anim extend peaks ~110 ms after detection + smoothing |

## Authoritative action timeline (golden replay, 30 Hz)

| Action | submit (sched) | punch_start | resolve | cleared | outcome |
| --- | --- | --- | --- | --- | --- |
| jab 1 (left/head) | t71 | t72 (age0) | t75 (age3) | t84 | block 44 + leak hit 14, blood 3 |
| jab 2 (identical) | t99 | t100 | t103 (age3) | t112 | block 44 + leak hit 15, blood 3 |
| straight (right/head) | t113 | t114 | t120 (age6) | knockdown clears | hit 66, blood 16, KD |

Note: submission is quantized to the next engine tick (+1 tick before `punch_start`).

## Visual animation timeline (current renderer)

Animator starts its own timeline when `action` appears in the *sampled* snapshot
(1-tick look-behind): jab detection ≈ t73+; extend envelope peaks at 42% of 260 ms
≈ +110 ms (≈ t76.3) plus ~40 ms glove smoothing lag ≈ **visual contact ≈ t77–78**,
versus server contact at **t75**. Straight: server contact t120; visual contact
≈ t123–124 (plus knockdown snap delay).

## Loss / delay / replacement / dedupe / miss points (exhaustive)

1. Keyboard: `event.repeat` suppression; Q/E guard press clears queued intent.
2. SharedActionIntent: identical consecutive intents coalesce; newest intent
   replaces older queued intent (capacity 1).
3. Gamepad chords: direction selectors consumed by face punches; RT+RS is taunt
   (shadows stance switch).
4. NetworkController: frames dropped while inactive/hidden/unfocused (neutral
   frame sent once); input only every 40 ms (client-side coalescing of rapid taps
   inside a flush window — two jabs within 40 ms collapse to one intent).
5. WS ingestion: oversize/invalid frames dropped; per-caller concurrency limits.
6. Rooms: one-use tickets; stale connection replacement; sequence replay drops
   (`sequence <= last_sequence`).
7. Engine intake: consecutive identical actions in one frame deduped; pending
   truncated to MAX_PENDING_ACTIONS (1); intent expires after 6 ticks; guard
   transition clears pending intent.
8. Engine lifecycle: stun clears attack; knockdown clears both fighters' pending
   actions; clinch clears queues; taunt locks dispatch; action starting while
   `attack` active is dropped silently (no queue).
9. Protocol/sampling: phase/knockdown transitions skip interpolation (snap to
   newest) — intentional, but a visible jump.
10. Presentation: action transitions only detected on class *change*; an identical
    punch re-authorized while the previous one is still on screen never restarts.

## Repeated-identical-jab case

Replay proves both jabs fire authoritatively (t72, t100) and both restart visually
**because** the action field returns to null for 16 ticks between them
(t84–t99). The failure case is a repeat inside the open action window: engine
accepts the intent (pending), starts the new jab the tick the old one clears, but
the client sees `action == "jab"` continuously → `activeAction` never differs →
**no visible restart**. This is the concrete defect behind acceptance criterion
"both consecutive identical jabs visibly restart" for fast repeat play.

## Movement interpolation between ordinary snapshots

`presentationFighter` lerps x/y/velocity/facing at `latest-1`; fighters move ≤ 7
units/tick (≈ 4.3 cm world) so ordinary movement is smooth with a constant 33 ms
display lag. Phase/knockdown boundaries snap (`return b`) — measured max single-
frame root motion over the replay: **1.153 m**, caused by (a) first-frame spawn
snap from the renderer's pre-positioned boxers and (b) the authoritative knockdown
teleport (`downed.x = ±140`). Ordinary movement never exceeds 5 cm; the teleports
are the only >5 cm sources and must become non-ordinary (staged slide) or be
visually absorbed.

## Visual contact point vs the server's hit test

Server hit test (`_resolve_punch`): planar distance/lateral checks along binary
`facing` at resolve tick — no glove geometry. Visual: IK glove on a self-paced
curve. Measured on the rendered result at the confirmed contact ticks:

- jab 1 (t75): glove-to-head **0.501 m** (criterion: 0.10 m)
- jab 2 (t103): glove-to-head **0.478 m**
- straight (t120): attack state already cleared on the resolve tick
  (`attack_one === null`) — the snapshot cannot even say which hand hit.

The visual glove lags the server contact by ~2–4 ticks; the animation is not
phase-locked to authoritative startup/active windows.

## Defects (prioritized)

### Simulation defects

- **S1 — attack state vanishes on the resolve tick for fight-ending hits.**
  Knockdown/stun clear `attack` immediately, so the snapshot at the contact tick
  has `action: null`; clients cannot identify the landing action instance.
- **S2 — no action instance identity.** The engine does not propagate a client
  action ID; reconciliation must guess by class/hand.
- **S3 — binary facing.** Server hit test cannot express arc/reach vs a facing
  angle; swept hitbox evaluation needs continuous facing (or facing-free range
  checks).
- **S4 — knockdown teleport.** `downed.x = ±140` is an authoritative 0.85 m
  discontinuity that violates any smooth-reconciliation guarantee unless staged.
- **S5 — contact tick not exposed.** Events carry `tick`, but snapshot attack
  fields expose neither age nor resolved startup/active/recovery, so clients
  cannot phase-lock.

### Protocol defects

- **P1 — no action-instance payload.** FighterSnapshot lacks
  action id/key/start tick/resolved phases/contact tick (goal-mandated model).
- **P2 — protocol version not bumped on schema change.** v1 silently changed with
  taunt_ticks; a stale client hard-fails. Any action-instance change must bump
  to v2 with explicit negotiation.
- **P3 — identical-repeat invisibility.** Class-only action field cannot express
  "same class, new instance" (needs the instance id).

### Presentation defects

- **R1 — animator timelines are self-paced, not authoritative.** The 0.48–0.50 m
  contact miss. Punch playback must be driven by manifest startup/active/recovery
  against the server's start tick, with predicted local startup reconciled.
- **R2 — fixed 1-tick look-behind.** Constant 33 ms lag regardless of jitter;
  should be adaptive or reduced for the local player.
- **R3 — identical restart invisibility** (see P3).
- **R4 — hitstop/reaction/sound/camera not synchronized to one confirmed frame.**
  They key off event arrival, not the contact marker.
- **R5 — teleport discontinuities** (S4) rendered raw.
- **R6 — planted-foot sliding exists** (1.7 cm idle FK drift measured) and is not
  constrained by foot locking.

### Asset defects

- **A1 — no skinned GLB humanoid;** the procedural rig cannot express authored
  clips, layered blending, or marker-exported trajectories.
- **A2 — no authored clips** for idle/move/jab/guard/reactions/knockdown.
- **A3 — no data-derived hurtboxes/hitboxes.** Lab overlays are manually sized
  spheres/capsules, not animation-marker exports.
- **A4 — timing constants duplicated** across `rules.py`, `animation.ts`
  (PUNCH_DURATION), and HUD; no shared manifest.

## PlayCanvas MCP note

The PlayCanvas Editor MCP automates the PlayCanvas hosted editor. HANDS is a
three.js renderer with a Python authority — there is no PlayCanvas project for it
to drive, so it is not applicable to this task. (It would become useful only if
the project moved authoring into the PlayCanvas Editor.)

## Remediation order (implemented next, in this branch)

1. combat-manifest.json shared by Python and TypeScript (A4, S5, P1 data).
2. Action-instance model end-to-end: client edge IDs, engine echo, snapshot
   fields, protocol v2 (S1, S2, P1, P2, P3, R3).
3. Predicted local startup + reconciliation (R1, R2) with hitstop/sound/camera
   synchronized to the confirmed contact tick (R4).
4. Skinned GLB + authored clips + animation graph (A1, A2, R6) with hurtbox/
   hitbox marker export (A3) and lab debug overlay (exists, to be data-driven).
5. Golden-replay acceptance evidence: filmstrip, logs, metrics.
