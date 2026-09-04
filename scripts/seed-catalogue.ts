import type { Database } from '../src/lib/supabase/database.types';

type TrackingMode = Database['public']['Enums']['tracking_mode'];

export type SeedProduct = {
  barcode: string;
  name: string;
  brand: string;
  size: string;
  category: string;
  default_shelf_life_days: number | null;
  tracking_mode: TrackingMode;
};

/**
 * The demo catalogue, spanning all three tracking modes so every portal has something
 * real to show. Barcodes are invented but carry correct GTIN check digits — the app
 * rejects invalid ones at manual entry, and `seed-catalogue.test.ts` holds that line.
 */
export const SEED_CATALOGUE: SeedProduct[] = [
  { barcode: '9300675024235', name: 'Coke Zero Sugar 1.25L', brand: 'Coca-Cola', size: '1.25L',
    category: 'Soft drinks', default_shelf_life_days: 270, tracking_mode: 'batch' },
  { barcode: '9300675024242', name: 'Coke Zero Sugar 2L', brand: 'Coca-Cola', size: '2L',
    category: 'Soft drinks', default_shelf_life_days: 240, tracking_mode: 'batch' },
  { barcode: '9300601001019', name: 'Full Cream Milk 2L', brand: 'Pura', size: '2L',
    category: 'Dairy', default_shelf_life_days: 12, tracking_mode: 'rotation' },
  { barcode: '9310072020105', name: 'Tip Top White Sandwich', brand: 'Tip Top', size: '700g',
    category: 'Bakery', default_shelf_life_days: 5, tracking_mode: 'rotation' },
  { barcode: '9300682001007', name: 'Mars Bar 53g', brand: 'Mars', size: '53g',
    category: 'Confectionery', default_shelf_life_days: 300, tracking_mode: 'batch' },
  { barcode: '9310155000017', name: 'Winfield Blue 25s', brand: 'Winfield', size: '25s',
    category: 'Tobacco', default_shelf_life_days: null, tracking_mode: 'none' },
];
