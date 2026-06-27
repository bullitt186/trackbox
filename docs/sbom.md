# Software Bill of Materials

## Generate SBOM
```sh
pip install cyclonedx-bom
cyclonedx-py requirements -r requirements.lock -o sbom.json --format json
```

## Dependencies
See requirements.lock for pinned production dependencies.
See requirements-dev.txt for development/CI dependencies.
