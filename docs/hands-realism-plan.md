# Hands realism overhaul

Branch `feature/hands-realism`. Goal: make the Hands Discord Activity a realistic,
responsive boxing game with injuries and gore, on the existing authoritative
Python engine, websocket rooms, persistence, and ratings.

## Baseline findings (2026-09-28)

Measured against `origin/main` at 992a4f5 with the dev fixture, the model lab,
and the engine source.

Simulation and protocol

- Punches only hit along the ring x axis. `_resolve_punch` projects onto the
  binary `facing` sign, so fighters offset along ring depth whiff while the
  presentation shows them squared up.
- A second punch pressed during the first is dropped. `ACTION_BUFFER_TICKS`
  (6) expires before a 13-tick jab clears, so `pending_actions` is cleared
  before it can dispatch. There is no recovery cancel, so combos cannot flow.
- Get-up teleports the downed fighter to `x = +-140`, which the client hides
  with a 0.85 m slide.

Presentation and network

- Movement stutters at 15 Hz. The renderer samples a fixed `latest.tick - 1`
  and snapshots arrive every second tick, so the pose holds for about four
  frames and jumps.
- Input is polled every 40 ms instead of sent on the key edge, and there is no
  local movement prediction, so footwork lags by round trip plus polling.
- Punch, guard, movement, reaction, and knockdown clips are retarget-baked
  from a capsule rig through direction-only child aim. Elbow and wrist twist
  are uncontrolled and the knockdown never reaches the canvas.
- Injuries are colored spheres and boxes parented to the head bone. They
  float beside the textured face. Gibs are red icosahedra; the severed head is
  a scaled sphere; the referee is a capsule mannequin.
- Five 105 cd fill spotlights plus bloom wash the image to pastel and blow out
  the white rope. The broadcast camera sits 7 m back, so fighters occupy
  roughly a third of the frame height.

## Plan

1. Simulation feel: continuous facing vector with limited turn rate and a
   facing-relative hit test; input buffer that survives the current punch;
   late-recovery combo cancels; knockdown separation by the referee instead of
   a teleport; protocol v3 carrying `facing_x`, `facing_y`, and the last
   processed input sequence.
2. Netcode: continuous render clock with adaptive interpolation delay,
   30 Hz broadcast, edge-triggered action sends, and local movement prediction
   for the viewer's fighter.
3. Animation: a runtime pose system on the Texel skeleton (stance, guards,
   punches that reach the live target, footwork with planted feet and pivots,
   spring-damper hit reactions, keyframed falls and get-ups) replacing the
   retarget-baked clips.
4. Injuries and gore: face and body damage painted into the skin textures
   (bruising, cuts, swelling displacement, flowing blood), blood on gloves and
   canvas, stretched droplet sprites, and mesh-based decapitation and
   dismemberment for the arcade finishers.
5. Presentation: closer broadcast framing with impact and knockdown cameras,
   corrected lighting and exposure, layered impact audio, and a skinned
   referee.

Every phase lands as its own commits with Python and Vitest coverage, a
rebuilt committed bundle, and screenshots captured through headless Chromium.

## Status (2026-09-29)

All five phases landed on `feature/hands-realism` (PR #293). Beyond the plan, the branch also
carries: adaptive render resolution with a no-gain revert, crowd excitement, rest-phase corner
walk with stools and a cutman who climbs in to work the worse eye (engine + client), anti-parallel
facing fix, knockout presentation (slow-motion replay, close-up, held result panel, winner
celebration, referee wave-off), portrait framing with a compact scoreboard, per-round and per-bout
punch stats, rope flex under a pinned fighter, face-down knockdowns after hooks, a real clinch
tie-up (the engine draws the fighters to a hold distance; one hooks over, the other under), a
legible showboat taunt, glove trails on fast punches, a rendered root that follows the engine at a
fixed speed per second, a broken nose under heavy head trauma, a glove touch before the opening
bell, a shadow-boxing waiting screen, rematches, plain-language failure text and a copyable
diagnostics panel.

Review harnesses: `?model-lab=1&pose=...` (pose lab), `?fixture=1` with `&finisher=head|hand`,
`&phase=rest`, `&pin=1|corner`, `&blood=reduced|off`, `&platform=mobile`, `?lab=1` (golden replay), and the Discord-free
real-stack harness (`scripts/hands_e2e_server.py` plus `scripts/hands_e2e_scenarios.js` with the
ko, reconnect, rest, spectator, touch, mash, latency, soak, background, rematch, rematchloop and
clinch scenarios; see the README).

Considered and not done: starting round 1 from the corners (the engine tests and the golden
replay schedule assume the centre start). A live Discord Activity launch with the server's players
still has to happen outside this repository's tooling.
