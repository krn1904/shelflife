import type { Database } from './database.types';

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type Enums<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T];

export type AppRole = Enums<'app_role'>;
export type TrackingMode = Enums<'tracking_mode'>;
export type ExpirySource = Enums<'expiry_source'>;
export type ActionState = Enums<'action_state'>;
export type ExpiryActionKind = Enums<'expiry_action_kind'>;
export type BatchStep = Enums<'batch_step'>;
export type WasteReason = Enums<'waste_reason'>;

export type Product = Tables<'products'>;
export type SiteProduct = Tables<'site_products'>;
