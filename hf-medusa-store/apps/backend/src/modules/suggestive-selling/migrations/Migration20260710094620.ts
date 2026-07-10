import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260710094620 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "suggestion_event" add column if not exists "tier" text null, add column if not exists "slot" integer null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "suggestion_event" drop column if exists "tier", drop column if exists "slot";`);
  }

}
