import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuditLogsIndexes1791952000000 implements MigrationInterface {
  name = 'AuditLogsIndexes1791952000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_logs_module_created" ON "audit_logs" ("module_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_logs_action" ON "audit_logs" ("action")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_audit_logs_module_created"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_action"`);
  }
}
