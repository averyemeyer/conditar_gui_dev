# conDitar GUI OpenShift Release Bundle

This release bundle is for deploying the conDitar GUI inside a site-managed
OpenShift project. It is intended to keep user data inside the site environment:
the GUI, job storage, and generator pods all run in OpenShift.

## What Runs Where

- The user's computer only opens the GUI URL in a browser.
- OpenShift runs the GUI pod.
- OpenShift stores job inputs, logs, and outputs on a PVC mounted at `/data`.
- OpenShift launches conDitar generator pods as Kubernetes Jobs.

Docker Desktop is not required on the user's computer.

## Recommended First Deployment

Start with the shortest setup path in `openshift/SITE_QUICKSTART.md`.

In plain terms:

1. Unzip the release package.
2. Open the OpenShift Web Terminal, or use a local terminal with `oc`.
3. Run one deploy command with the site project name.

If the site uses an approved OpenShift automation process, such as a pipeline
triggered from an internal repository or approved image registry, use this
package as the source content for that process. The deployment shape is still
the same: GUI image, Route, PVC-backed job storage, RBAC, and OpenShift Jobs.

CPU-only validation command:

```bash
./openshift/deploy.sh \
  --project <site-project> \
  --runtime openshift_job \
  --submit \
  --cpu \
  --runtime-image docker.io/osuninglab/conditar-dev:2026-07-10
```

On Windows PowerShell, use:

```powershell
.\openshift\deploy.ps1 `
  -Project <site-project> `
  -Runtime openshift_job `
  -Submit `
  -Cpu `
  -RuntimeImage docker.io/osuninglab/conditar-dev:2026-07-10
```

If the site cannot pull from Docker Hub, mirror the runtime image first and use
the mirrored image reference as `--runtime-image`.

## Files In This Bundle

- `openshift/SITE_QUICKSTART.md`: shortest setup path.
- `openshift/VALIDATION_PROTOCOL.md`: first test run and expected results.
- `openshift/IMAGE_TRANSFER.md`: runtime image options and mirroring notes.
- `openshift/TRANSFER_CHECKLIST.md`: admin-facing assumptions and questions.
- `openshift/site.env.example`: configurable environment values.
- `openshift/deploy.sh`: macOS/Linux/Git Bash deploy script.
- `openshift/deploy.ps1`: Windows PowerShell deploy script.
- `openshift/*.yaml`: OpenShift manifests.

## Site Values To Confirm

- OpenShift project/namespace.
- Whether external image pulls from Docker Hub are allowed.
- If not, which internal registry should host the runtime image.
- Storage class and storage size.
- Whether storage is `ReadWriteOnce` or `ReadWriteMany`.
- Route/TLS policy.
- CPU-only or GPU execution.
- GPU resource name, if used, such as `nvidia.com/gpu`.

## Validation Goal

The first successful validation is small:

- Open the GUI Route.
- Choose `OpenShift Job`.
- Run 2 samples on CPU with Vina off.
- Confirm logs show sampling progress.
- Confirm the job completes and SDF results load.

After that, test Vina and GPU settings if needed.
