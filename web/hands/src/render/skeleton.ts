/** Canonical bone name → Barbarian armature bone name (single source of truth). */
export const BONE_ADAPTER: Record<string, string> = {
  hips: "hips",
  spine: "spine",
  chest: "chest",
  head: "head",
  shoulderL: "upperarml",
  elbowL: "lowerarml",
  gloveL: "wristl",
  shoulderR: "upperarmr",
  elbowR: "lowerarmr",
  gloveR: "wristr",
  hipL: "upperlegl",
  kneeL: "lowerlegl",
  ankleL: "footl",
  hipR: "upperlegr",
  kneeR: "lowerlegr",
  ankleR: "footr",
};
