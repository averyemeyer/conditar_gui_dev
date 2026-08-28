# conDitar Runtime Image Transfer

The release uses two container images:

- GUI image: built from this bundle by OpenShift, unless the site chooses to
  prebuild and host it internally.
- Runtime image: the conDitar generator image launched by OpenShift Jobs.

## Default Runtime Image

Use this first if the OpenShift project can pull from Docker Hub:

```text
docker.io/osuninglab/conditar-dev:2026-07-10
```

Deploy command:

```bash
./openshift/deploy.sh \
  --project <site-project> \
  --runtime openshift_job \
  --submit \
  --cpu \
  --runtime-image docker.io/osuninglab/conditar-dev:2026-07-10
```

## If External Pulls Are Blocked

Ask the site admin to mirror the runtime image into an approved registry. A
typical internal OpenShift registry reference looks like:

```text
image-registry.openshift-image-registry.svc:5000/<site-project>/conditar-runtime:2026-07-10
```

Then deploy with:

```bash
./openshift/deploy.sh \
  --project <site-project> \
  --runtime openshift_job \
  --submit \
  --cpu \
  --runtime-image image-registry.openshift-image-registry.svc:5000/<site-project>/conditar-runtime:2026-07-10
```

## If The Site Requires Tar Files

If the site cannot pull from Docker Hub and prefers offline image import, provide
a runtime image archive created from the source image:

```bash
podman pull docker.io/osuninglab/conditar-dev:2026-07-10
podman save -o conditar-runtime-2026-07-10.tar docker.io/osuninglab/conditar-dev:2026-07-10
```

The site admin can import that tar into their approved registry using their
standard image import process.

The GUI image can also be prebuilt and transferred as a tar if the site does not
allow OpenShift binary builds.
