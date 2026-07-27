import type { BloodLevel } from "../settings";
import type { FighterSnapshot, MatchPhase } from "../types";
import type { Point } from "./geometry";

export interface FighterStyle { readonly skin: string; readonly trunks: string; readonly glove: string; readonly accent: string }
interface PosePoint { readonly x: number; readonly y: number }
export interface FighterPose {
  readonly leftFoot: PosePoint;
  readonly rightFoot: PosePoint;
  readonly leftGlove: PosePoint;
  readonly rightGlove: PosePoint;
  readonly torsoShift: number;
  readonly torsoDrop: number;
  readonly torsoLean: number;
}

export function fighterPose(fighter: FighterSnapshot): FighterPose {
  const orthodox = fighter.stance === "orthodox";
  const stride = Math.max(-8, Math.min(8, fighter.velocity_x * 1.15));
  const leftFoot = orthodox ? { x: 17 + stride, y: 0 } : { x: -13 - stride, y: -3 };
  const rightFoot = orthodox ? { x: -13 - stride, y: -3 } : { x: 17 + stride, y: 0 };
  let leftGlove = orthodox ? { x: 22, y: -77 } : { x: 7, y: -88 };
  let rightGlove = orthodox ? { x: 7, y: -88 } : { x: 22, y: -77 };
  let torsoShift = 0;
  let torsoDrop = 0;
  let torsoLean = 0;

  if (fighter.defense === "guard_high") {
    leftGlove = orthodox ? { x: 4, y: -91 } : { x: 13, y: -86 };
    rightGlove = orthodox ? { x: 13, y: -86 } : { x: 4, y: -91 };
  } else if (fighter.defense === "guard_low") {
    leftGlove = orthodox ? { x: 10, y: -57 } : { x: 18, y: -54 };
    rightGlove = orthodox ? { x: 18, y: -54 } : { x: 10, y: -57 };
  }
  if (fighter.clinch_startup_ticks > 0 || fighter.clinch_ticks > 0) {
    leftGlove = { x: 30, y: -82 };
    rightGlove = { x: 36, y: -66 };
  } else if (fighter.action !== null && fighter.action_hand !== null && fighter.action_target !== null && fighter.action_power !== null) {
    const targetY = fighter.action_target === "body" ? -61 : -82;
    const powerReach = fighter.action_power === "power" ? 8 : 0;
    const extension = fighter.action === "jab"
      ? { x: 48 + powerReach * 0.35, y: targetY - 1 }
      : fighter.action === "straight"
        ? { x: 59 + powerReach, y: targetY + 2 }
        : fighter.action === "hook"
          ? { x: 33 + powerReach, y: targetY + 6 }
          : { x: 21 + powerReach, y: targetY - 14 };
    if (fighter.action === "straight") {
      torsoShift = 4 + powerReach * 0.25;
      torsoLean = 0.055;
    }
    if (fighter.action_hand === "left") leftGlove = extension;
    else rightGlove = extension;
  }
  if (fighter.is_foul_recovery_target) {
    leftGlove = { x: -5, y: -58 };
    rightGlove = { x: 11, y: -55 };
    torsoShift = -3;
    torsoDrop = 9;
    torsoLean = -0.075;
  }
  return { leftFoot, rightFoot, leftGlove, rightGlove, torsoShift, torsoDrop, torsoLean };
}

const limb = (ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, width: number, color: string): void => {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
};

export function drawFighter(
  ctx: CanvasRenderingContext2D,
  fighter: FighterSnapshot,
  point: Point,
  _phase: MatchPhase,
  style: FighterStyle,
  time: number,
  reducedMotion = false,
  blood: BloodLevel = "full",
): void {
  ctx.save();
  ctx.translate(point.x, point.y);
  const scale = point.scale * Math.min(1, 0.92 + fighter.maximum_stamina / Math.max(1, fighter.stamina + fighter.maximum_stamina) * 0.08);
  ctx.scale(scale, scale);
  const facing = fighter.facing < 0 ? -1 : 1;
  ctx.scale(facing, 1);

  const down = fighter.is_downed;
  const pose = fighterPose(fighter);
  const tired = 1 - fighter.stamina / Math.max(1, fighter.maximum_stamina);
  const animationTime = reducedMotion ? 0 : time;
  const bob = down ? 0 : Math.sin(animationTime * (5 - tired * 2) + fighter.x * 0.01) * (1.5 + tired * 2);
  if (down) {
    ctx.translate(0, 3);
    ctx.rotate(-Math.PI * 0.43);
    ctx.scale(0.92, 0.92);
  } else if (fighter.clinch_ticks > 0) {
    ctx.translate(18, 5);
    ctx.rotate(-0.11);
  } else if (fighter.clinch_startup_ticks > 0) {
    ctx.translate(10, 2);
  } else if (fighter.defense === "weave") ctx.translate(0, 13);
  else if (fighter.defense === "pull") ctx.translate(-12, -3);
  else if (fighter.defense === "slip_left") ctx.rotate(-0.12);
  else if (fighter.defense === "slip_right") ctx.rotate(0.12);
  ctx.translate(pose.torsoShift, pose.torsoDrop);
  ctx.rotate(pose.torsoLean);

  const impact = fighter.stunned_ticks > 0 ? Math.min(7, 2 + fighter.stunned_ticks / 15) : 0;
  const impactPulse = reducedMotion ? impact : Math.sin(animationTime * 31) * impact;
  ctx.translate(-impactPulse, bob + impactPulse * 0.3);
  if (impact > 0) ctx.transform(1, 0, -Math.min(0.12, impact / 70), 1, 0, 0);

  ctx.globalAlpha = 0.28;
  ctx.fillStyle = "#050608";
  ctx.beginPath();
  ctx.ellipse(0, 4, down ? 55 : 28, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  limb(ctx, -8, -28, pose.leftFoot.x, pose.leftFoot.y, 9, style.skin);
  limb(ctx, 8, -28, pose.rightFoot.x, pose.rightFoot.y, 9, style.skin);
  ctx.fillStyle = style.trunks;
  ctx.beginPath();
  ctx.moveTo(-16, -50);
  ctx.lineTo(16, -50);
  ctx.lineTo(13, -27);
  ctx.lineTo(-13, -27);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = style.accent;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  const stanceDirection = fighter.stance === "orthodox" ? 1 : -1;
  ctx.moveTo(-10 * stanceDirection, -47);
  ctx.lineTo(10 * stanceDirection, -31);
  ctx.stroke();

  ctx.fillStyle = style.skin;
  ctx.beginPath();
  ctx.moveTo(-15, -76);
  ctx.quadraticCurveTo(0, -84, 16, -76);
  ctx.lineTo(13, -48);
  ctx.lineTo(-13, -48);
  ctx.closePath();
  ctx.fill();
  const bodyTrauma = Math.min(0.72, fighter.trauma.body / 1100);
  ctx.fillStyle = `rgba(73,31,92,${bodyTrauma})`;
  ctx.beginPath();
  ctx.ellipse(stanceDirection * -5, -62, 8 + fighter.trauma.body / 220, 11, 0.25 * stanceDirection, 0, Math.PI * 2);
  ctx.fill();

  limb(ctx, -11, -72, pose.leftGlove.x, pose.leftGlove.y, 10, style.skin);
  limb(ctx, 11, -72, pose.rightGlove.x, pose.rightGlove.y, 10, style.skin);
  for (const [index, glove] of [pose.leftGlove, pose.rightGlove].entries()) {
    const leadIndex = fighter.stance === "orthodox" ? 0 : 1;
    ctx.fillStyle = style.glove;
    ctx.beginPath();
    const powered = fighter.action_power === "power" && fighter.action_hand === (index === 0 ? "left" : "right");
    ctx.ellipse(glove.x, glove.y, powered ? 10.5 : 9, powered ? 9.5 : 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = index === leadIndex ? style.accent : "rgba(255,255,255,.35)";
    ctx.lineWidth = index === leadIndex ? 2 : 1.5;
    ctx.stroke();
  }

  const leftSwelling = fighter.trauma.left_eye / 150 + fighter.trauma.swelling / 350;
  const rightSwelling = fighter.trauma.right_eye / 150 + fighter.trauma.swelling / 350;
  ctx.fillStyle = style.skin;
  ctx.beginPath();
  ctx.ellipse(0, -99, 14 + (leftSwelling + rightSwelling) * 0.35, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(76,28,86,${Math.min(0.78, (fighter.trauma.head + fighter.trauma.swelling) / 900)})`;
  ctx.beginPath();
  ctx.ellipse(-6, -101, 5 + leftSwelling, 3 + leftSwelling * 0.45, -0.2, 0, Math.PI * 2);
  ctx.ellipse(6, -101, 5 + rightSwelling, 3 + rightSwelling * 0.45, 0.2, 0, Math.PI * 2);
  ctx.fill();
  if (blood !== "off") {
    const bloodScale = blood === "reduced" ? 0.45 : 1;
    ctx.strokeStyle = `rgba(132,10,18,${Math.min(1, (fighter.trauma.left_cut + fighter.trauma.bleeding) / 350) * bloodScale})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-10, -108);
    ctx.lineTo(-4, -103);
    ctx.stroke();
    ctx.strokeStyle = `rgba(132,10,18,${Math.min(1, (fighter.trauma.right_cut + fighter.trauma.bleeding) / 350) * bloodScale})`;
    ctx.beginPath();
    ctx.moveTo(10, -108);
    ctx.lineTo(4, -103);
    ctx.stroke();
  }
  if (fighter.is_foul_recovery_target) {
    ctx.strokeStyle = "#ffd36d";
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(-25, -122, 50, 128);
    ctx.setLineDash([]);
  }
  if (tired > 0.55 && !down) {
    ctx.fillStyle = "rgba(190,230,255,.65)";
    for (let index = 0; index < 3; index += 1) {
      ctx.beginPath();
      ctx.arc(-9 + index * 8, -82 + Math.sin(animationTime * 3 + index) * 4, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
