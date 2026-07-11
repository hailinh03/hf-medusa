import { Migration } from '@medusajs/framework/mikro-orm/migrations'

export class Migration20260711180000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "product_bulk_mapping" ("id" text not null, "source_product_id" text not null, "bulk_product_id" text not null, "pack_size" integer not null default 2, "priority" integer not null default 0, "is_active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "product_bulk_mapping_pkey" primary key ("id"));`)
    this.addSql(`create index if not exists "IDX_product_bulk_mapping_source_active_priority" on "product_bulk_mapping" ("source_product_id", "is_active", "priority") where "deleted_at" is null;`)
    // Cart rules are dynamic strategies. Fixed items belong only to product rules.
    this.addSql(`delete from "suggestion_rule_item" where "rule_id" in (select "id" from "suggestion_rule" where "type" = 'cart');`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "product_bulk_mapping" cascade;`)
  }
}
