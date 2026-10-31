# Isolated application regression tests

Start Docker Desktop, then run from this repository in PowerShell:

```powershell
docker compose -f compose.test.yaml up -d --wait
$env:TEST_REDIS_URL='redis://127.0.0.1:16379'
npm test
```

The Compose project creates its own network and Redis container. It has no
shared volumes or production credentials, binds only to this computer, and
does not use CivicFlow or MedRef. Redis data is disposable and lost when the
container stops. This is test infrastructure, not the production application.

Stop only this test project:

```powershell
docker compose -f compose.test.yaml down
```

If the earlier manually created `grammarflow-test-redis` is still running,
stop it before starting Compose because both use local port 16379. Preserve
that container until the Compose replacement passes its checks.

Dev Editor browser isolation checks are separate; see
`dev-editor-demo/README.md`. Passing application tests does not establish
browser isolation or make Dev Editor ready for public deployment.
