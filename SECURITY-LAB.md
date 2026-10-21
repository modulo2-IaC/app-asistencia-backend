# Laboratorio local de seguridad — backend

Este repo usa pnpm para dependencias, Secretlint para buscar credenciales y Husky + lint-staged para revisar los archivos preparados antes de un commit. **No hay GitHub Actions configuradas.**

## Qué se ejecuta automáticamente y qué no

El hook `.husky/pre-commit` ejecuta `pnpm exec lint-staged` y revisa con Secretlint los archivos staged. El hook `.husky/pre-push` ejecuta la auditoría de dependencias, un escaneo completo de secretos, lint sin autofix, build y pruebas. Puedes ejecutar cada comando manualmente también; el pre-push los vuelve a ejecutar antes de permitir el push.

Los hooks locales son protecciones preventivas, no garantías absolutas: pueden omitirse con `git commit --no-verify` o `git push --no-verify`. Este laboratorio tampoco escanea el historial de Git. El pre-push puede tardar y requiere conectividad al registro npm para `pnpm audit`.

## 1. Completar la migración a pnpm

Requisito: pnpm 12.14.0 (la versión fijada en `package.json`). Desde este directorio:

```bash
pnpm --version
pnpm install
```

La primera instalación actualiza/genera `pnpm-lock.yaml` con las dependencias declaradas, incluidas Secretlint, Husky y lint-staged. Revisa cualquier aviso de scripts de instalación; no apruebes scripts en bloque. La política de `pnpm-workspace.yaml` deniega explícitamente los tres scripts que se detectaron inicialmente.

Cuando la instalación finalice correctamente y el lockfile pnpm esté actualizado, elimina el lockfile npm de la migración (`rm package-lock.json`) y verifica la instalación reproducible:

```bash
pnpm install --frozen-lockfile
```

No elimines `package-lock.json` antes de tener un `pnpm-lock.yaml` actualizado.

## 2. Revisar dependencias

```bash
pnpm run security:audit
```

El comando usa `pnpm audit --audit-level high`. Un hallazgo alto/crítico hará que el comando falle: revisa el paquete afectado, actualiza o corrige la dependencia y vuelve a auditar. Un resultado limpio solo significa que la fuente consultada no reportó vulnerabilidades conocidas para ese árbol; no demuestra ausencia absoluta de vulnerabilidades.

La configuración de pnpm espera siete días antes de resolver versiones recién publicadas, rechaza dependencias transitivas de fuentes exóticas y requiere aprobación para ejecutar scripts de instalación. El período se configura en minutos (`10080`) y en modo estricto. [Políticas de seguridad de pnpm](https://pnpm.io/supply-chain-security)

## 3. Escanear todos los archivos elegibles

```bash
pnpm run security:secrets
# Ambos controles, en secuencia:
pnpm run security
```

Secretlint utiliza el preset recomendado. Los directorios y artefactos ignorados por Git —como `node_modules`, `dist`, `.terraform/` y `*.tfstate*`— no forman parte del escaneo normal. Los archivos Terraform `.tf` sí pueden analizarse. Los estados de Terraform pueden contener valores sensibles: no los agregues al repo ni uses `git add -f` para forzar su inclusión.

Los `.env` locales están ignorados. `.env.example` puede versionarse, pero debe contener únicamente valores ficticios o vacíos.

## 4. Probar detección y bloqueo del commit

Haz esta prueba con el árbol de trabajo limpio, en una rama descartable. El contenido siguiente es deliberadamente ficticio; **nunca uses una clave real**.

```bash
git switch -c test/backend-secretlint
cat > secretlint-smoke-test.txt <<'EOF'
-----BEGIN PRIVATE KEY-----
NOT_A_REAL_KEY_FOR_SECURITY_TEST_ONLY
-----END PRIVATE KEY-----
EOF
```

Primero comprueba el escáner directo. Se espera un resultado distinto de cero y un hallazgo de clave privada:

```bash
pnpm exec secretlint --no-glob secretlint-smoke-test.txt
```

Luego prepara el archivo y prueba el hook. El commit **debe bloquearse**:

```bash
git add secretlint-smoke-test.txt
git commit -m "test: verificar bloqueo de secretos"
```

Para demostrar que un archivo corregido pasa, reemplaza el contenido por texto inocuo, vuelve a prepararlo y repite el commit:

```bash
printf 'Texto ficticio sin credenciales.\n' > secretlint-smoke-test.txt
git add secretlint-smoke-test.txt
git commit -m "test: verificar commit sin secretos"
```

Al terminar, regresa a la rama anterior y elimina la rama de prueba (ajusta el nombre de la rama base si hace falta):

```bash
git switch dev
git branch -D test/backend-secretlint
```

Si el commit de prueba con la clave no se bloquea, confirma que `pnpm install` terminó (el script `prepare` instala Husky) y revisa `git config --local core.hooksPath`. No continúes con credenciales reales.

## 5. Ejecutar las verificaciones de la aplicación

El hook pre-push ejecuta estas verificaciones; también puedes lanzarlas manualmente:

```bash
pnpm run build
pnpm exec jest --runInBand
```

Para probar el pre-push sin enviar cambios, en la rama de prueba deja un commit inocuo y crea el archivo ficticio como archivo sin seguimiento. Ejecuta `git push --dry-run origin HEAD` (requiere que exista el remoto `origin`); el hook debe bloquearlo al encontrar el secreto. El modo `--dry-run` no actualiza el remoto, pero sí da oportunidad al hook local de rechazar el push. Luego elimina el archivo y repite el dry-run: si las validaciones restantes pasan, debe continuar. Si el repo no tiene `origin`, puedes probar el flujo ejecutando `sh .husky/pre-push`; eso prueba los comandos, pero no confirma que Git tenga instalado el hook.

## Evidencia para presentar

Guarda capturas o transcripciones sin datos sensibles de: versión de pnpm; configuración `pnpm-workspace.yaml`; instalación congelada; resultado de auditoría; escaneo sin hallazgos; escáner detectando la clave ficticia; commit bloqueado; commit de archivo corregido permitido; build y pruebas. No incluyas archivos `.env`, estados Terraform ni tokens reales en la evidencia.
