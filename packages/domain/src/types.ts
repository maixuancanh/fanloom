export type ConsentStatus = "active" | "revoked";

export type Consent = {
  status: ConsentStatus;
  purposes: string[];
};

export type Money = {
  /** JSON-safe minor units; convert to bigint only at the persistence boundary. */
  amountMinor: string;
  currency: string;
};

export type CampaignArtifact = {
  id: string;
  creatorId: string;
  objectKey: string;
  sha256: string;
  mediaType: string;
  byteSize: number;
  retentionUntil: Date;
  deletedAt: Date | null;
};
