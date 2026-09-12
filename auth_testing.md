# MyVolt Auth Testing

Auth: JWT (httpOnly cookie `access_token`, 12h) + bcrypt. Frontend ALSO stores the token in
localStorage and sends `Authorization: Bearer <token>` as a fallback (cookies use SameSite=None).
Both cookie and bearer are accepted by the backend.

## Accounts (all password: Route39@2026)
- Admin: support@route39.in
- Operations Manager: ops@route39.in
- City Manager (Chennai only): chennai@route39.in
- Service Manager: service@route39.in
- Staff: staff@route39.in

## API checks
```
curl -c cookies.txt -X POST $URL/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"support@route39.in","password":"Route39@2026"}'
# returns user + token, sets cookies
TOKEN=... ; curl $URL/api/auth/me -H "Authorization: Bearer $TOKEN"   # 200
```

## UI login flow
Fill [data-testid="login-email"] + [data-testid="login-password"], click [data-testid="login-submit"].
On success the app calls setUser(data) directly and redirects to /dashboard (no /auth/me needed).
A refresh works because /auth/me is called with the Bearer token from localStorage.

Endpoints: /api/auth/login, /api/auth/logout, /api/auth/me, /api/auth/refresh
