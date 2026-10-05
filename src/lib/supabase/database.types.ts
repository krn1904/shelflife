
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
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
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
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
          docket_reading: Json | null
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
          docket_reading?: Json | null
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
          docket_reading?: Json | null
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
          corrected_at: string | null
          corrected_by: string | null
          created_at: string
          delivery_id: string
          id: string
          org_id: string
          product_id: string
          qty_docketed: number
          qty_received: number
          staff_qty_docketed: number | null
          staff_qty_received: number | null
          unit_cost: number | null
          updated_at: string
        }
        Insert: {
          corrected_at?: string | null
          corrected_by?: string | null
          created_at?: string
          delivery_id: string
          id?: string
          org_id: string
          product_id: string
          qty_docketed?: number
          qty_received?: number
          staff_qty_docketed?: number | null
          staff_qty_received?: number | null
          unit_cost?: number | null
          updated_at?: string
        }
        Update: {
          corrected_at?: string | null
          corrected_by?: string | null
          created_at?: string
          delivery_id?: string
          id?: string
          org_id?: string
          product_id?: string
          qty_docketed?: number
          qty_received?: number
          staff_qty_docketed?: number | null
          staff_qty_received?: number | null
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
          archived_at: string | null
          archived_by: string | null
          created_at: string
          id: string
          is_demo: boolean
          name: string
          slug: string
          status: Database["public"]["Enums"]["org_status"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          id?: string
          is_demo?: boolean
          name: string
          slug: string
          status?: Database["public"]["Enums"]["org_status"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          id?: string
          is_demo?: boolean
          name?: string
          slug?: string
          status?: Database["public"]["Enums"]["org_status"]
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
          org_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
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
          org_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
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
          org_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          size?: string | null
          tracking_mode?: Database["public"]["Enums"]["tracking_mode"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
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
      reminder_settings: {
        Row: {
          created_at: string
          long_check_days: number
          long_markdown_days: number
          medium_markdown_days: number
          medium_max_days: number
          org_id: string
          short_markdown_days: number
          short_max_days: number
          site_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          long_check_days?: number
          long_markdown_days?: number
          medium_markdown_days?: number
          medium_max_days?: number
          org_id: string
          short_markdown_days?: number
          short_max_days?: number
          site_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          long_check_days?: number
          long_markdown_days?: number
          medium_markdown_days?: number
          medium_max_days?: number
          org_id?: string
          short_markdown_days?: number
          short_max_days?: number
          site_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reminder_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_settings_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: true
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
      site_message_reads: {
        Row: {
          message_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          message_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          message_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_message_reads_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "site_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      site_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          org_id: string
          sent_by: string | null
          site_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          org_id: string
          sent_by?: string | null
          site_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          org_id?: string
          sent_by?: string | null
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_messages_site_id_fkey"
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
          timezone: string
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
          checked_at: string | null
          created_at: string
          delivery_line_id: string | null
          expiry_date: string | null
          expiry_photo_path: string | null
          expiry_source: Database["public"]["Enums"]["expiry_source"]
          id: string
          marked_down_at: string | null
          org_id: string
          product_id: string
          qty_received: number
          qty_remaining: number
          site_id: string
          status: Database["public"]["Enums"]["batch_status"]
          updated_at: string
        }
        Insert: {
          checked_at?: string | null
          created_at?: string
          delivery_line_id?: string | null
          expiry_date?: string | null
          expiry_photo_path?: string | null
          expiry_source?: Database["public"]["Enums"]["expiry_source"]
          id?: string
          marked_down_at?: string | null
          org_id: string
          product_id: string
          qty_received: number
          qty_remaining: number
          site_id: string
          status?: Database["public"]["Enums"]["batch_status"]
          updated_at?: string
        }
        Update: {
          checked_at?: string | null
          created_at?: string
          delivery_line_id?: string | null
          expiry_date?: string | null
          expiry_photo_path?: string | null
          expiry_source?: Database["public"]["Enums"]["expiry_source"]
          id?: string
          marked_down_at?: string | null
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
      supplier_aliases: {
        Row: {
          alias: string
          created_at: string
          created_by: string | null
          id: string
          org_id: string
          supplier_id: string
        }
        Insert: {
          alias: string
          created_at?: string
          created_by?: string | null
          id?: string
          org_id: string
          supplier_id: string
        }
        Update: {
          alias?: string
          created_at?: string
          created_by?: string | null
          id?: string
          org_id?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_aliases_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_aliases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          abn: string | null
          active: boolean
          contact_note: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          abn?: string | null
          active?: boolean
          contact_note?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          abn?: string | null
          active?: boolean
          contact_note?: string | null
          created_at?: string
          created_by?: string | null
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
          client_id: string | null
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
          client_id?: string | null
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
          client_id?: string | null
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
      add_organisation_member: {
        Args: {
          p_email: string
          p_org_id: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_site_id: string | null
          p_user_id: string
        }
        Returns: string
      }
      add_site_member: {
        Args: {
          p_email: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_site_id: string
          p_user_id: string
        }
        Returns: string
      }
      add_supplier: {
        Args: { p_abn?: string | null; p_name: string; p_org_id: string }
        Returns: {
          existing: boolean
          supplier_id: string
        }[]
      }
      archive_organisation: {
        Args: { p_confirm_slug: string; p_org_id: string }
        Returns: undefined
      }
      auth_org_ids: { Args: never; Returns: string[] }
      auth_site_ids: { Args: never; Returns: string[] }
      batch_unit_cost: {
        Args: { p_batch: Database["public"]["Tables"]["stock_batches"]["Row"] }
        Returns: number
      }
      can_correct_site: { Args: { p_site_id: string }; Returns: boolean }
      can_manage_org: { Args: { org: string }; Returns: boolean }
      can_manage_site: { Args: { org: string }; Returns: boolean }
      can_manage_site_role: {
        Args: {
          p_role: Database["public"]["Enums"]["app_role"]
          p_site_id: string
        }
        Returns: boolean
      }
      clear_active_expiry_actions: { Args: never; Returns: number }
      correct_delivery_line: {
        Args: {
          p_batches: Json
          p_line_id: string
          p_qty_docketed: number
          p_qty_received: number
        }
        Returns: string
      }
      create_organisation_site: {
        Args: {
          p_address: string | null
          p_name: string
          p_org_id: string
          p_timezone: string
        }
        Returns: string
      }
      demo_jump_days: {
        Args: { p_days: number; p_org_id: string }
        Returns: number
      }
      expiry_engine_due: { Args: { p_at?: string }; Returns: boolean }
      has_org_role: {
        Args: { org: string; roles: Database["public"]["Enums"]["app_role"][] }
        Returns: boolean
      }
      insert_active_expiry_actions: {
        Args: { p_actions: Json }
        Returns: number
      }
      has_active_membership: { Args: never; Returns: boolean }
      is_valid_timezone: { Args: { p_timezone: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      merge_suppliers: {
        Args: { p_alias?: string | null; p_keep_id: string; p_remove_id: string }
        Returns: number
      }
      record_waste: {
        Args: {
          p_batch_id: string
          p_client_id?: string
          p_note?: string
          p_qty: number
          p_reason: Database["public"]["Enums"]["waste_reason"]
        }
        Returns: string
      }
      organisation_waste_total: {
        Args: { p_org_id: string }
        Returns: number
      }
      provision_organisation: {
        Args: {
          p_name: string
          p_owner_email: string
          p_owner_user_id: string
          p_site_address: string | null
          p_site_name: string
          p_site_timezone: string
          p_slug: string
        }
        Returns: Json
      }
      resolve_batch_step: {
        Args: {
          p_batch_id: string
          p_client_id?: string
          p_qty?: number
          p_step: Database["public"]["Enums"]["batch_step"]
        }
        Returns: Database["public"]["Enums"]["batch_status"]
      }
      restore_organisation: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      review_docket_product: {
        Args: {
          p_barcode: string | null
          p_brand: string | null
          p_fixture: string | null
          p_name: string
          p_product_id: string
          p_shelf_life_days: number | null
          p_site_id: string
          p_size: string | null
          p_tracking_mode: Database["public"]["Enums"]["tracking_mode"]
        }
        Returns: number
      }
      supplier_activity: {
        Args: { p_org_id: string }
        Returns: {
          deliveries: number
          last_delivered_at: string | null
          supplier_id: string
        }[]
      }
      update_organisation_member: {
        Args: {
          p_membership_id: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_site_id: string | null
        }
        Returns: string
      }
      update_supplier: {
        Args: {
          p_abn: string | null
          p_active: boolean
          p_name: string
          p_old_alias?: string | null
          p_supplier_id: string
        }
        Returns: undefined
      }
      upsert_active_rotation_checks: {
        Args: { p_checks: Json }
        Returns: number
      }
      remember_supplier_docket: {
        Args: { p_abn?: string | null; p_alias: string | null; p_supplier_id: string }
        Returns: undefined
      }
      remove_empty_site: {
        Args: { p_site_id: string }
        Returns: string
      }
      remove_site_member: { Args: { p_membership_id: string }; Returns: string }
      remove_organisation_member: {
        Args: { p_membership_id: string }
        Returns: string
      }
      shares_org_with: { Args: { other_user: string }; Returns: boolean }
      write_audit: {
        Args: {
          p_action: string
          p_detail?: Json
          p_org_id?: string
          p_site_id?: string
          p_subject_id?: string
          p_subject_type?: string
        }
        Returns: string
      }
    }
    Enums: {
      action_state: "open" | "done" | "dismissed"
      app_role: "platform_admin" | "owner" | "manager" | "staff"
      batch_status: "active" | "pulled" | "sold_through"
      batch_step: "checked" | "marked_down" | "sold" | "pulled"
      delivery_status: "draft" | "closed"
      expiry_action_kind: "check" | "markdown" | "pull"
      expiry_source: "predicted" | "confirmed" | "manual"
      org_status: "active" | "archived"
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

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
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
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      action_state: ["open", "done", "dismissed"],
      app_role: ["platform_admin", "owner", "manager", "staff"],
      batch_status: ["active", "pulled", "sold_through"],
      batch_step: ["checked", "marked_down", "sold", "pulled"],
      delivery_status: ["draft", "closed"],
      expiry_action_kind: ["check", "markdown", "pull"],
      expiry_source: ["predicted", "confirmed", "manual"],
      org_status: ["active", "archived"],
      tracking_mode: ["rotation", "batch", "none"],
      waste_reason: [
        "expired",
        "damaged",
        "spoiled",
        "recalled",
        "staff_error",
        "other",
      ],
    },
  },
} as const
