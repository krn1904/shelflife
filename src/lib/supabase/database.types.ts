// NOTE: every table below except memberships, orgs, products, profiles, site_products,
// sites and suppliers was written by hand — as were the record_waste and write_audit
// functions — because the environment that added them had no database to run
// `supabase gen types typescript --local > src/lib/supabase/database.types.ts` against.
// Regenerate this file once the migrations have actually been applied — the generated
// output is authoritative. The Relationships entries here were derived from the foreign
// keys in the migration and are what makes `select('... suppliers(name)')` type-check;
// the received_by -> auth.users key is omitted because the generator does not expose it.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          operationName?: string
          query?: string
          variables?: Json
          extensions?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          detail: Json | null
          id: string
          org_id: string | null
          site_id: string | null
          subject_id: string | null
          subject_type: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          id?: string
          org_id?: string | null
          site_id?: string | null
          subject_id?: string | null
          subject_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          id?: string
          org_id?: string | null
          site_id?: string | null
          subject_id?: string | null
          subject_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      deliveries: {
        Row: {
          closed_at: string | null
          created_at: string
          docket_number: string | null
          docket_photo_path: string | null
          id: string
          org_id: string
          received_at: string | null
          received_by: string | null
          site_id: string
          status: Database["public"]["Enums"]["delivery_status"]
          supplier_id: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          docket_number?: string | null
          docket_photo_path?: string | null
          id?: string
          org_id: string
          received_at?: string | null
          received_by?: string | null
          site_id: string
          status?: Database["public"]["Enums"]["delivery_status"]
          supplier_id: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          docket_number?: string | null
          docket_photo_path?: string | null
          id?: string
          org_id?: string
          received_at?: string | null
          received_by?: string | null
          site_id?: string
          status?: Database["public"]["Enums"]["delivery_status"]
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_lines: {
        Row: {
          created_at: string
          delivery_id: string
          id: string
          org_id: string
          product_id: string
          qty_docketed: number
          qty_received: number
          unit_cost: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          delivery_id: string
          id?: string
          org_id: string
          product_id: string
          qty_docketed?: number
          qty_received?: number
          unit_cost?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          delivery_id?: string
          id?: string
          org_id?: string
          product_id?: string
          qty_docketed?: number
          qty_received?: number
          unit_cost?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_lines_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      expiry_actions: {
        Row: {
          action: Database["public"]["Enums"]["expiry_action_kind"]
          actioned_at: string | null
          actioned_by: string | null
          batch_id: string
          created_at: string
          due_date: string
          id: string
          org_id: string
          site_id: string
          state: Database["public"]["Enums"]["action_state"]
          updated_at: string
        }
        Insert: {
          action: Database["public"]["Enums"]["expiry_action_kind"]
          actioned_at?: string | null
          actioned_by?: string | null
          batch_id: string
          created_at?: string
          due_date: string
          id?: string
          org_id: string
          site_id: string
          state?: Database["public"]["Enums"]["action_state"]
          updated_at?: string
        }
        Update: {
          action?: Database["public"]["Enums"]["expiry_action_kind"]
          actioned_at?: string | null
          actioned_by?: string | null
          batch_id?: string
          created_at?: string
          due_date?: string
          id?: string
          org_id?: string
          site_id?: string
          state?: Database["public"]["Enums"]["action_state"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expiry_actions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "stock_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expiry_actions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expiry_actions_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      job_runs: {
        Row: {
          duration_ms: number | null
          id: string
          job: string
          ok: boolean
          processed: number
          ran_at: string
          reason: string | null
          skipped: number
        }
        Insert: {
          duration_ms?: number | null
          id?: string
          job: string
          ok: boolean
          processed?: number
          ran_at?: string
          reason?: string | null
          skipped?: number
        }
        Update: {
          duration_ms?: number | null
          id?: string
          job?: string
          ok?: boolean
          processed?: number
          ran_at?: string
          reason?: string | null
          skipped?: number
        }
        Relationships: []
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["app_role"]
          site_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role: Database["public"]["Enums"]["app_role"]
          site_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          site_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      orgs: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          barcode: string | null
          brand: string | null
          category: string | null
          created_at: string
          created_by: string | null
          default_shelf_life_days: number | null
          id: string
          name: string
          size: string | null
          tracking_mode: Database["public"]["Enums"]["tracking_mode"]
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          brand?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          default_shelf_life_days?: number | null
          id?: string
          name: string
          size?: string | null
          tracking_mode?: Database["public"]["Enums"]["tracking_mode"]
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          brand?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          default_shelf_life_days?: number | null
          id?: string
          name?: string
          size?: string | null
          tracking_mode?: Database["public"]["Enums"]["tracking_mode"]
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          failed_at: string | null
          failure_reason: string | null
          id: string
          org_id: string
          p256dh: string
          site_id: string | null
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          org_id: string
          p256dh: string
          site_id?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          org_id?: string
          p256dh?: string
          site_id?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      rotation_checks: {
        Row: {
          check_date: string
          checked_at: string | null
          checked_by: string | null
          created_at: string
          fixture: string
          id: string
          org_id: string
          site_id: string
          state: Database["public"]["Enums"]["action_state"]
          updated_at: string
        }
        Insert: {
          check_date: string
          checked_at?: string | null
          checked_by?: string | null
          created_at?: string
          fixture: string
          id?: string
          org_id: string
          site_id: string
          state?: Database["public"]["Enums"]["action_state"]
          updated_at?: string
        }
        Update: {
          check_date?: string
          checked_at?: string | null
          checked_by?: string | null
          created_at?: string
          fixture?: string
          id?: string
          org_id?: string
          site_id?: string
          state?: Database["public"]["Enums"]["action_state"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rotation_checks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rotation_checks_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_products: {
        Row: {
          active: boolean
          created_at: string
          fixture: string | null
          id: string
          org_id: string
          par_level: number | null
          product_id: string
          retail_price: number | null
          site_id: string
          tracking_mode_override:
            | Database["public"]["Enums"]["tracking_mode"]
            | null
          unit_cost: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          fixture?: string | null
          id?: string
          org_id: string
          par_level?: number | null
          product_id: string
          retail_price?: number | null
          site_id: string
          tracking_mode_override?:
            | Database["public"]["Enums"]["tracking_mode"]
            | null
          unit_cost?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          fixture?: string | null
          id?: string
          org_id?: string
          par_level?: number | null
          product_id?: string
          retail_price?: number | null
          site_id?: string
          tracking_mode_override?:
            | Database["public"]["Enums"]["tracking_mode"]
            | null
          unit_cost?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_products_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_products_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          address: string | null
          created_at: string
          id: string
          name: string
          org_id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          name: string
          org_id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_batches: {
        Row: {
          created_at: string
          delivery_line_id: string | null
          expiry_date: string | null
          expiry_photo_path: string | null
          expiry_source: Database["public"]["Enums"]["expiry_source"]
          id: string
          org_id: string
          product_id: string
          qty_received: number
          qty_remaining: number
          site_id: string
          status: Database["public"]["Enums"]["batch_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          delivery_line_id?: string | null
          expiry_date?: string | null
          expiry_photo_path?: string | null
          expiry_source?: Database["public"]["Enums"]["expiry_source"]
          id?: string
          org_id: string
          product_id: string
          qty_received: number
          qty_remaining: number
          site_id: string
          status?: Database["public"]["Enums"]["batch_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          delivery_line_id?: string | null
          expiry_date?: string | null
          expiry_photo_path?: string | null
          expiry_source?: Database["public"]["Enums"]["expiry_source"]
          id?: string
          org_id?: string
          product_id?: string
          qty_received?: number
          qty_remaining?: number
          site_id?: string
          status?: Database["public"]["Enums"]["batch_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_batches_delivery_line_id_fkey"
            columns: ["delivery_line_id"]
            isOneToOne: false
            referencedRelation: "delivery_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_batches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_batches_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          active: boolean
          contact_note: string | null
          created_at: string
          id: string
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          contact_note?: string | null
          created_at?: string
          id?: string
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          contact_note?: string | null
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      waste_events: {
        Row: {
          batch_id: string | null
          created_at: string
          id: string
          note: string | null
          org_id: string
          product_id: string
          qty: number
          reason: Database["public"]["Enums"]["waste_reason"]
          site_id: string
          value_aud: number | null
          wasted_at: string
          wasted_by: string | null
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          org_id: string
          product_id: string
          qty: number
          reason: Database["public"]["Enums"]["waste_reason"]
          site_id: string
          value_aud?: number | null
          wasted_at?: string
          wasted_by?: string | null
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          org_id?: string
          product_id?: string
          qty?: number
          reason?: Database["public"]["Enums"]["waste_reason"]
          site_id?: string
          value_aud?: number | null
          wasted_at?: string
          wasted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "waste_events_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "stock_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waste_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waste_events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waste_events_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_org_ids: {
        Args: Record<PropertyKey, never>
        Returns: string[]
      }
      auth_site_ids: {
        Args: Record<PropertyKey, never>
        Returns: string[]
      }
      can_manage_org: {
        Args: { org: string }
        Returns: boolean
      }
      can_manage_site: {
        Args: { org: string }
        Returns: boolean
      }
      has_org_role: {
        Args: { org: string; roles: Database["public"]["Enums"]["app_role"][] }
        Returns: boolean
      }
      is_platform_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      record_waste: {
        Args: {
          p_batch_id: string
          p_qty: number
          p_reason: Database["public"]["Enums"]["waste_reason"]
          p_note?: string
        }
        Returns: string
      }
      shares_org_with: {
        Args: { other_user: string }
        Returns: boolean
      }
      write_audit: {
        Args: {
          p_action: string
          p_org_id?: string
          p_site_id?: string
          p_subject_type?: string
          p_subject_id?: string
          p_detail?: Json
        }
        Returns: string
      }
    }
    Enums: {
      action_state: "open" | "done" | "dismissed"
      app_role: "platform_admin" | "owner" | "manager" | "staff"
      batch_status: "active" | "pulled" | "sold_through"
      delivery_status: "draft" | "closed"
      expiry_action_kind: "check" | "markdown" | "pull"
      expiry_source: "predicted" | "confirmed" | "manual"
      tracking_mode: "rotation" | "batch" | "none"
      waste_reason:
        | "expired"
        | "damaged"
        | "spoiled"
        | "recalled"
        | "staff_error"
        | "other"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["platform_admin", "owner", "manager", "staff"],
      tracking_mode: ["rotation", "batch", "none"],
    },
  },
} as const

