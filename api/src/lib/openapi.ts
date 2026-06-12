// Generates an OpenAPI 3.1 spec from the Zod schemas declared inline below
// (we don't import the route-level schemas to keep this module decoupled —
// they're the same shapes anyway). The spec is served at /api/docs.

import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

const bearer = registry.registerComponent('securitySchemes', 'bearer', {
  type: 'http', scheme: 'bearer', bearerFormat: 'JWT',
});

// ---- Shared schemas ----

const ErrorResponse = registry.register('Error', z.object({
  error: z.string(),
  reasons: z.array(z.string()).optional(),
}));

const LoginRequest = registry.register('LoginRequest', z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
}));

const LoginResponse = registry.register('LoginResponse', z.object({
  token: z.string().describe('Short-lived JWT access token'),
  role: z.enum(['SUPERVISOR', 'PETUGAS', 'ADMIN']),
  nama: z.string(),
  mustChangePassword: z.boolean(),
}));

const ChangePasswordRequest = registry.register('ChangePasswordRequest', z.object({
  currentPassword: z.string(),
  newPassword: z.string()
    .describe('Must satisfy policy: ≥12 chars, upper+lower+digit+symbol, no common words'),
}));

const Petugas = registry.register('Petugas', z.object({
  id: z.string(),
  kode: z.string(),
  nama: z.string(),
  wilayah: z.string(),
  status: z.enum(['LAPANGAN', 'ISTIRAHAT', 'KANTOR']),
}));

const Nasabah = registry.register('Nasabah', z.object({
  id: z.string(),
  kode: z.string(),
  nama: z.string(),
  alamat: z.string(),
  hp: z.string(),
  petugasId: z.string(),
  kol: z.enum(['K1', 'K2', 'K3', 'K4', 'K5']),
  akad: z.enum(['MURABAHAH', 'MUSYARAKAH', 'IJARAH', 'MUSYARAKAH_MUTANAQISAH', 'ISTISHNA']),
  plafon: z.string().describe('BigInt serialized as decimal string'),
  sisa: z.string(),
  angsuran: z.string(),
  dpd: z.number().int(),
  dueIn: z.number().int(),
}));

const BlastCreateRequest = registry.register('BlastCreateRequest', z.object({
  judul: z.string().max(200).optional(),
  kanal: z.enum(['WA', 'SMS']),
  template: z.string().max(2000),
  recipientIds: z.array(z.string()).min(1).max(5000),
  scheduledAt: z.string().datetime().optional(),
}));

// ---- Path registrations ----

registry.registerPath({
  method: 'post', path: '/api/auth/login', tags: ['Auth'],
  summary: 'Authenticate with username + password',
  request: { body: { content: { 'application/json': { schema: LoginRequest } } } },
  responses: {
    200: { description: 'Login OK; sets bsn_rt httpOnly refresh cookie',
      content: { 'application/json': { schema: LoginResponse } } },
    401: { description: 'Invalid credentials', content: { 'application/json': { schema: ErrorResponse } } },
    423: { description: 'Account locked (too many failed attempts)', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post', path: '/api/auth/refresh', tags: ['Auth'],
  summary: 'Rotate refresh token, return new access token',
  description: 'Requires bsn_rt cookie. Reuse-detection: a previously-rotated token blows up the entire family.',
  responses: {
    200: { description: 'Token rotated', content: { 'application/json': { schema: LoginResponse.partial({ mustChangePassword: true }) } } },
    401: { description: 'No / expired / reused token', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post', path: '/api/auth/logout', tags: ['Auth'],
  summary: 'Revoke refresh family + clear cookie',
  security: [{ [bearer.name]: [] }],
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } } },
});

registry.registerPath({
  method: 'post', path: '/api/auth/change-password', tags: ['Auth'],
  summary: 'Change password (revokes all refresh tokens)',
  security: [{ [bearer.name]: [] }],
  request: { body: { content: { 'application/json': { schema: ChangePasswordRequest } } } },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
    400: { description: 'Weak password / same as current', content: { 'application/json': { schema: ErrorResponse } } },
    401: { description: 'Current password wrong', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get', path: '/api/petugas', tags: ['Petugas'],
  summary: 'List all petugas',
  security: [{ [bearer.name]: [] }],
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: z.array(Petugas) } } } },
});

registry.registerPath({
  method: 'get', path: '/api/nasabah', tags: ['Nasabah'],
  summary: 'List nasabah (petugas role: only owned)',
  security: [{ [bearer.name]: [] }],
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: z.array(Nasabah) } } } },
});

registry.registerPath({
  method: 'patch', path: '/api/nasabah/{id}/petugas', tags: ['Nasabah'],
  summary: 'Reassign nasabah to another petugas (supervisor only)',
  security: [{ [bearer.name]: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: z.object({ petugasId: z.string() }) } } },
  },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: Nasabah } } } },
});

registry.registerPath({
  method: 'post', path: '/api/blast', tags: ['Blast'],
  summary: 'Queue a new blast (supervisor only)',
  security: [{ [bearer.name]: [] }],
  request: { body: { content: { 'application/json': { schema: BlastCreateRequest } } } },
  responses: { 201: { description: 'Queued', content: { 'application/json': { schema: z.object({ jobId: z.string() }) } } } },
});

registry.registerPath({
  method: 'get', path: '/health', tags: ['System'],
  summary: 'Liveness probe',
  responses: { 200: { description: 'Process alive', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } } },
});

registry.registerPath({
  method: 'get', path: '/health/ready', tags: ['System'],
  summary: 'Readiness probe (DB connectivity)',
  responses: {
    200: { description: 'Ready', content: { 'application/json': { schema: z.object({ ok: z.boolean(), db: z.literal('up') }) } } },
    503: { description: 'DB unreachable', content: { 'application/json': { schema: z.object({ ok: z.boolean(), db: z.literal('down') }) } } },
  },
});

export function buildOpenApi() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'BSN Lacak API',
      version: '0.1.0',
      description: 'Sistem Tracking Penagihan — Bank Syariah Nasional',
    },
    servers: [{ url: '/', description: 'Same origin' }],
  });
}
