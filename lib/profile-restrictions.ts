import {
  getClientProfileById,
  getClientProfileCode,
  type ClientProfile,
} from "@/lib/client-profiles";

export type ProfileRestrictionMode =
  | "automatic"
  | "allowed_profiles"
  | "forced_profile";

export type OCRProfileRestriction = {
  allowedProfiles: string[];
  forcedProfile?: string;
  mode: ProfileRestrictionMode;
};

export type ProfileRestrictionDecision = {
  allowedProfiles: string[];
  detectedProfileBeforeRestriction: ClientProfile;
  finalProfile: ClientProfile;
  forcedProfile?: string;
  restrictionMode: ProfileRestrictionMode;
  restrictionReason: string;
};

export class OCRProfileRestrictionError extends Error {
  readonly allowedProfiles: string[];
  readonly detectedProfile: ClientProfile;
  readonly restrictionMode: ProfileRestrictionMode;

  constructor(input: {
    allowedProfiles: string[];
    detectedProfile: ClientProfile;
    restrictionMode: ProfileRestrictionMode;
  }) {
    super(
      `El documento parece ser ${input.detectedProfile.userFacingExtractionType ?? input.detectedProfile.label}, pero el codigo de acceso actual no permite procesar ese tipo documental.`,
    );
    this.name = "OCRProfileRestrictionError";
    this.allowedProfiles = input.allowedProfiles;
    this.detectedProfile = input.detectedProfile;
    this.restrictionMode = input.restrictionMode;
  }
}

export function automaticProfileRestriction(): OCRProfileRestriction {
  return {
    allowedProfiles: [],
    mode: "automatic",
  };
}

export function normalizeProfileRestriction(input?: {
  allowedProfiles?: readonly string[] | null;
  forcedProfile?: string | null;
  mode?: string | null;
}): OCRProfileRestriction {
  const allowedProfiles = Array.from(
    new Set(
      (input?.allowedProfiles ?? [])
        .map((profileId) => getClientProfileCode(getClientProfileById(profileId)))
        .filter((profileId) => profileId !== "internal-general"),
    ),
  );
  const forcedProfile = input?.forcedProfile
    ? getClientProfileCode(getClientProfileById(input.forcedProfile))
    : undefined;
  const requestedMode = input?.mode?.trim().toLowerCase();

  if (requestedMode === "forced_profile" && forcedProfile) {
    return {
      allowedProfiles: [],
      forcedProfile,
      mode: "forced_profile",
    };
  }

  if (requestedMode === "allowed_profiles" && allowedProfiles.length > 0) {
    return {
      allowedProfiles,
      mode: "allowed_profiles",
    };
  }

  return automaticProfileRestriction();
}

export function applyProfileRestriction(
  detectedProfile: ClientProfile,
  restriction?: OCRProfileRestriction,
): ProfileRestrictionDecision {
  const normalized = normalizeProfileRestriction(restriction);
  const detectedProfileId = getClientProfileCode(detectedProfile);

  if (normalized.mode === "forced_profile" && normalized.forcedProfile) {
    const finalProfile = getClientProfileById(normalized.forcedProfile);
    return {
      allowedProfiles: [],
      detectedProfileBeforeRestriction: detectedProfile,
      finalProfile,
      forcedProfile: finalProfile.id,
      restrictionMode: normalized.mode,
      restrictionReason: `El administrador configuro el perfil obligatorio ${finalProfile.id}.`,
    };
  }

  if (normalized.mode === "allowed_profiles") {
    if (!normalized.allowedProfiles.includes(detectedProfileId)) {
      throw new OCRProfileRestrictionError({
        allowedProfiles: normalized.allowedProfiles,
        detectedProfile,
        restrictionMode: normalized.mode,
      });
    }

    return {
      allowedProfiles: normalized.allowedProfiles,
      detectedProfileBeforeRestriction: detectedProfile,
      finalProfile: detectedProfile,
      restrictionMode: normalized.mode,
      restrictionReason: "El perfil detectado esta incluido entre los perfiles permitidos.",
    };
  }

  return {
    allowedProfiles: [],
    detectedProfileBeforeRestriction: detectedProfile,
    finalProfile: detectedProfile,
    restrictionMode: "automatic",
    restrictionReason: "Deteccion automatica sin restricciones documentales.",
  };
}

