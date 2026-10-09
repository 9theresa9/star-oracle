/** Dependency-free policy shared by Node 24 host tools and the compiled API image. */
export const SHARED_DB_HOST = 'oracle-mysql';
export const SHARED_DB_NAME = 'staroracle';
export type SharedRole = 'app' | 'migrator' | 'backup' | 'maintenance' | 'candidateImporter' | 'candidateMigrator' | 'candidateApp';
const dml = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
const ddl = [...dml, 'CREATE', 'ALTER', 'INDEX', 'REFERENCES'];
export const rolePrivileges: Record<SharedRole, string[]> = {
 app: dml, migrator: ddl, backup: ['SELECT'], maintenance: dml,
 candidateImporter: [...ddl, 'DROP'], candidateMigrator: ddl, candidateApp: dml,
};
export function databasePolicy(ok: unknown, code: string): asserts ok {
 if (!ok) throw new Error(code);
}
export function roleIdentity(role: SharedRole, database = SHARED_DB_NAME): {user: string; sourceIp: string} {
 databasePolicy(Object.hasOwn(rolePrivileges, role), 'SHARED_DB_ROLE');
 if (role.startsWith('candidate')) {
  const suffix = /^staroraclerestore([a-z0-9]{1,12})$/.exec(database)?.[1];
  databasePolicy(suffix, 'SHARED_DB_SCHEMA');
  const prefix = {candidateImporter:'sor_i_', candidateMigrator:'sor_m_', candidateApp:'sor_a_'}[role as 'candidateImporter'|'candidateMigrator'|'candidateApp'];
  return {user: prefix + suffix, sourceIp:'172.30.78.7'};
 }
 databasePolicy(database === SHARED_DB_NAME, 'SHARED_DB_SCHEMA');
 return {user: 'staroracle_' + role, sourceIp: '172.30.78.' + (role === 'app' ? 2 : role === 'migrator' ? 6 : 7)};
}
export type DatabaseIdentity = {currentUser: string; serverUuid: string; serverVersion: string; database: string; currentRole: string; mandatoryRoles: string};
export function validateDatabaseIdentity({role, identity, grants, expectedUuid, expectedVersion, database = SHARED_DB_NAME, sourceIp}: {
 role: SharedRole; identity: DatabaseIdentity; grants: string[]; expectedUuid: string; expectedVersion: string; database?: string; sourceIp: string;
}): true {
 const expected = roleIdentity(role, database);
 databasePolicy(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(expectedUuid) && /^8\.4\.\d+$/.test(expectedVersion), 'SHARED_DB_IDENTITY');
 databasePolicy(sourceIp === expected.sourceIp && identity?.currentUser === expected.user + '@' + expected.sourceIp &&
  identity.serverUuid === expectedUuid && identity.serverVersion === expectedVersion && identity.database === database &&
  identity.currentRole === 'NONE' && identity.mandatoryRoles === '', 'SHARED_DB_IDENTITY');
 // SHOW GRANTS is deliberately used WITHOUT FOR CURRENT_USER: on MySQL 8.4
 // the latter form omits mandatory roles. Unknown syntax fails closed.
 databasePolicy(Array.isArray(grants) && grants.length === 2, 'SHARED_DB_GRANTS');
 const grantee = '`' + expected.user + '`@`' + expected.sourceIp + '`';
 const usage = 'GRANT USAGE ON *.* TO ' + grantee;
 databasePolicy(grants.filter(line => line === usage).length === 1, 'SHARED_DB_GRANTS');
 const scoped = grants.find(line => line !== usage)!;
 const match = /^GRANT ([A-Z]+(?:, [A-Z]+)*) ON `([a-z0-9]+)`\.\* TO (`[a-z0-9_]+`@`[0-9.]+`)$/.exec(scoped);
 databasePolicy(match && match[2] === database && match[3] === grantee, 'SHARED_DB_GRANTS');
 const actual = match[1]!.split(', '), allowed = rolePrivileges[role];
 databasePolicy(actual.length === allowed.length && new Set(actual).size === actual.length && actual.every(privilege => allowed.includes(privilege)), 'SHARED_DB_GRANTS');
 return true;
}
export const identityQuery = "SELECT CURRENT_USER() AS currentUser, @@GLOBAL.server_uuid AS serverUuid, VERSION() AS serverVersion, DATABASE() AS `database`, CURRENT_ROLE() AS currentRole, @@GLOBAL.mandatory_roles AS mandatoryRoles";
export const identityJsonQuery = "SELECT JSON_OBJECT('currentUser', CURRENT_USER(), 'serverUuid', @@GLOBAL.server_uuid, 'serverVersion', VERSION(), 'database', DATABASE(), 'currentRole', CURRENT_ROLE(), 'mandatoryRoles', @@GLOBAL.mandatory_roles)";
export function validateProvisioningAudit(audit: unknown, database: string, serverUuid: string): true {
 const a = audit as Record<string, unknown> | undefined;
 databasePolicy(a && Object.keys(a).sort().join(',') === 'noAnonymousAccounts,noFallbackAccounts,noRolesOrExtraGrants,reviewedAt,schema,serverUuid,tablesOnly' &&
  a.schema === database && a.serverUuid === serverUuid && a.tablesOnly === true && a.noAnonymousAccounts === true &&
  a.noFallbackAccounts === true && a.noRolesOrExtraGrants === true && typeof a.reviewedAt === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(a.reviewedAt) && Number.isFinite(Date.parse(a.reviewedAt)) && Date.parse(a.reviewedAt) <= Date.now(), 'SHARED_DB_AUDIT');
 return true;
}
