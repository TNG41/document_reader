const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');

const COOKIE_NAME = process.env.JWT_COOKIE_NAME || 'dr_session';

function sessionCookieFor(role) {
  const token = jwt.sign(
    { sub: '11111111-1111-1111-1111-111111111111', email: `${role}@example.com`, role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' },
  );
  return `${COOKIE_NAME}=${token}`;
}

async function withCsrf(agent) {
  const tokenRes = await agent.get('/api/csrf-token');
  return tokenRes.body.csrfToken;
}

describe('GET /api/health', () => {
  it('returns 200 and status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('CSRF protection', () => {
  it('rejects a state-changing request without a matching CSRF token', async () => {
    const res = await request(app).delete('/api/documents/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CSRF_TOKEN_INVALID');
  });
});

describe('POST /api/documents (auth required)', () => {
  it('rejects an unauthenticated upload', async () => {
    const agent = request.agent(app);
    const csrfToken = await withCsrf(agent);

    const res = await agent
      .post('/api/documents')
      .set('x-csrf-token', csrfToken)
      .attach('file', Buffer.from('hello'), { filename: 'a.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('NOT_AUTHENTICATED');
  });

  it('rejects an unsupported file type once authenticated', async () => {
    const agent = request.agent(app);
    const csrfToken = await withCsrf(agent);

    const res = await agent
      .post('/api/documents')
      .set('Cookie', sessionCookieFor('user'))
      .set('x-csrf-token', csrfToken)
      .attach('file', Buffer.from('not a real doc'), {
        filename: 'malware.exe',
        contentType: 'application/x-msdownload',
      });

    expect(res.status).toBe(415);
    expect(res.body.error).toBe('UNSUPPORTED_FILE_TYPE');
  });
});

describe('PATCH /api/auth/password', () => {
  it('rejects an unauthenticated request', async () => {
    const agent = request.agent(app);
    const csrfToken = await withCsrf(agent);

    const res = await agent
      .patch('/api/auth/password')
      .set('x-csrf-token', csrfToken)
      .send({ currentPassword: 'old-password-123', newPassword: 'new-password-456' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('NOT_AUTHENTICATED');
  });

  it('rejects a new password under 10 characters before ever checking the current one', async () => {
    const agent = request.agent(app);
    const csrfToken = await withCsrf(agent);

    const res = await agent
      .patch('/api/auth/password')
      .set('Cookie', sessionCookieFor('user'))
      .set('x-csrf-token', csrfToken)
      .send({ currentPassword: 'whatever-it-is', newPassword: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_INPUT');
  });
});

describe('Role-based access — /api/users (admin only)', () => {
  it('blocks a plain user from the admin directory', async () => {
    const agent = request.agent(app);
    const csrfToken = await withCsrf(agent);

    const res = await agent
      .get('/api/users')
      .set('Cookie', sessionCookieFor('user'))
      .set('x-csrf-token', csrfToken);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('INSUFFICIENT_ROLE');
  });

  it('blocks an officer and an executive too — admin only means admin only', async () => {
    for (const role of ['officer', 'executive']) {
      const agent = request.agent(app);
      const csrfToken = await withCsrf(agent);
      const res = await agent
        .get('/api/users')
        .set('Cookie', sessionCookieFor(role))
        .set('x-csrf-token', csrfToken);
      expect(res.status).toBe(403);
    }
  });
});
