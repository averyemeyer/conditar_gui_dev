# Container images

- [`diffsmol/`](diffsmol/) contains the standalone DiffSMol image recipe,
  runtime scripts, and tests. It can be built from this checkout.
- The GUI image is built from [`../Containerfile`](../Containerfile).
- The standalone conDitar image is built from the
  [conDitar source repository](https://github.com/ninglab/conDitar-dev/tree/gui-dev/docker/conditar_dev),
  which contains its model code and build context. It is not built here.

The OpenShift launcher uses the immutable image references in
[`../openshift/image-list.txt`](../openshift/image-list.txt). Image binaries,
checkpoints, and exported archives are not stored in Git.
