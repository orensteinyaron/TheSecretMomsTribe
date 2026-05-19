export type RachelLookStatus = 'pending' | 'active' | 'retired';

export interface RachelLook {
  look_id: string;             // 'look_01', 'look_12', ...
  soul_still_id: string;
  soul_still_url: string;
  wardrobe: string;
  setting: string;
  notes: string | null;
  status: RachelLookStatus;
  created_at: string;
  approved_at: string | null;
  retired_at: string | null;
  created_by: string;
  source: 'canon_seed' | 'skill_v1';
}

export interface RecentPick {
  look_id: string;
  used_at: string;
}

export interface CreateLookInput {
  wardrobe: string;
  setting: string;
  notes?: string;
  variation_count?: number;
}

export interface CreateLookResult {
  candidate_look_ids: string[];
  candidates: Array<{
    look_id: string;
    soul_still_id: string;
    soul_still_url: string;
  }>;
}
