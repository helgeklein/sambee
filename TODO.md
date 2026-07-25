# TODO

## File list

- Make file operations discoverable by adding a toolbar with icons below the bar that contains the connection list
- When I select multiple files and then press DEL, only one is deleted instead of all of them.
- Dual-pane mode: Ctrl+left/right to change the location (connection+path) of the left pane to that of the right pane and vice-versa

## Markdown editor

- Search + replace (Ctrl+H)

## Authentication system

- OAuth/OIDC:
   - Add OAuth as authentication method in addition to password and none.
   - Configuration should be via the UI (limited to Sambee users with admin rights).
      - If possible, we should add a configuration validation option for users to check their config works.
   - Optional auto-provisioning, where new OAuth users are auto-created in Sambee
      - To be configurable via the UI
   - Optional mapping of OAuth groups to Sambee roles
      - Members of group A to become Sambee admins
      - Members of group B to become Sambee editors
      - Members of group C to become Sambee viewers
   - Create documentation
      - Include a full example for Authelia as OAuth provider/IdP that includes the necessary config on the Authelia side

## Theme

- import/export, e.g., as JSON

## Image viewer

- Support multi-page image files:
  - TIFF
  - ICO (test with uberAgent icon)

- Additional formats
   - DCM (medical image format)
