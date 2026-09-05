import type { Database } from './database.types';

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type Enums<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T];

export type AppRole = Enums<'app_role'>;
export type TrackingMode = Enums<'tracking_mode'>;
export type DeliveryStatus = Enums<'delivery_status'>;
export type ExpirySource = Enums<'expiry_source'>;
export type BatchStatus = Enums<'batch_status'>;
export type ActionState = Enums<'action_state'>;
export type ExpiryActionKind = Enums<'expiry_action_kind'>;
export type WasteReason = Enums<'waste_reason'>;

export type Org = Tables<'orgs'>;
export type Site = Tables<'sites'>;
export type Membership = Tables<'memberships'>;
export type Supplier = Tables<'suppliers'>;
export type Product = Tables<'products'>;
export type SiteProduct = Tables<'site_products'>;
export type Delivery = Tables<'deliveries'>;
export type DeliveryLine = Tables<'delivery_lines'>;
export type StockBatch = Tables<'stock_batches'>;
export type ExpiryAction = Tables<'expiry_actions'>;
export type RotationCheck = Tables<'rotation_checks'>;
export type WasteEvent = Tables<'waste_events'>;
export type JobRun = Tables<'job_runs'>;
