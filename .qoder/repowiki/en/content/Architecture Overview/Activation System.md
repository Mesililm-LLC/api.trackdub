# Activation System

<cite>
**Referenced Files in This Document**
- [src/activation/index.ts](file://src/activation/index.ts)
- [src/activation/config.ts](file://src/activation/config.ts)
- [src/activation/schema.ts](file://src/activation/schema.ts)
- [src/activation/types.ts](file://src/activation/types.ts)
- [src/activation/middleware.ts](file://src/activation/middleware.ts)
- [src/activation/routes/activate.ts](file://src/activation/routes/activate.ts)
- [src/activation/routes/deactivate.ts](file://src/activation/routes/deactivate.ts)
- [src/activation/routes/reactivate.ts](file://src/activation/routes/reactivate.ts)
- [src/activation/routes/status.ts](file://src/activation/routes/status.ts)
- [src/activation/routes/admin.ts](file://src/activation/routes/admin.ts)
- [src/activation/lib/authorize.ts](file://src/activation/lib/authorize.ts)
- [src/activation/lib/jwt.ts](file://src/activation/lib/jwt.ts)
- [src/activation/lib/license-key.ts](file://src/activation/lib/license-key.ts)
- [src/activation/lib/license-lookup.ts](file://src/activation/lib/license-lookup.ts)
- [src/activation/lib/respond.ts](file://src/activation/lib/respond.ts)
- [src/activation/lib/seats.ts](file://src/activation/lib/seats.ts)
- [drizzle-activation/0000_activation_init.sql](file://drizzle-activation/0000_activation_init.sql)
- [wrangler.activation.jsonc](file://wrangler.activation.jsonc)
- [wrangler.activation.staging.jsonc](file://wrangler.activation.staging.jsonc)
- [vitest.activation.config.ts](file://vitest.activation.config.ts)
- [test/activation/activate.test.ts](file://test/activation/activate.test.ts)
- [test/activation/deactivate.test.ts](file://test/activation/deactivate.test.ts)
- [test/activation/reactivate.test.ts](file://test/activation/reactivate.test.ts)
- [test/activation/admin.test.ts](file://test/activation/admin.test.ts)
- [test/activation/dev-license.test.ts](file://test/activation/dev-license.test.ts)
- [test/activation/helpers.ts](file://test/activation/helpers.ts)
- [test/activation/test-keys.ts](file://test/activation/test-keys.ts)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)
10. [Appendices](#appendices)

## Introduction
This document describes the Activation System for api.trackdub.com, a Cloudflare Worker backend that manages license activation, deactivation, reactivation, and status queries. It is implemented as a Hono-based module with Zod validation, Drizzle ORM migrations for D1 (SQLite), and JWT-based tokens for activation payloads. The system exposes endpoints to activate a license against a seat count, deactivate it, reactivate when needed, and query current activation state. Administrative operations are supported via dedicated routes protected by authorization middleware.

The Activation System is isolated from the main app’s auth flow but integrates with shared middleware for logging, request-id, error handling, and validation. Configuration is validated at first request using environment variables, and secrets are managed through Wrangler secrets or local .dev.vars.

## Project Structure
The Activation System lives under src/activation and includes:
- Entry point and router wiring
- Configuration and schema definitions
- Route handlers for activation lifecycle
- Shared libraries for authorization, JWT, license key management, lookup, response helpers, and seat accounting
- Drizzle migration for activation-specific tables
- Wrangler configuration for separate deployment profiles
- Comprehensive tests covering activation flows and admin operations

```mermaid
graph TB
subgraph "Activation Module"
A_Index["src/activation/index.ts"]
A_Config["src/activation/config.ts"]
A_Schema["src/activation/schema.ts"]
A_Types["src/activation/types.ts"]
A_MW["src/activation/middleware.ts"]
end
subgraph "Routes"
R_Activate["routes/activate.ts"]
R_Deactivate["routes/deactivate.ts"]
R_Reactivate["routes/reactivate.ts"]
R_Status["routes/status.ts"]
R_Admin["routes/admin.ts"]
end
subgraph "Lib"
L_Authorize["lib/authorize.ts"]
L_JWT["lib/jwt.ts"]
L_Key["lib/license-key.ts"]
L_Lookup["lib/license-lookup.ts"]
L_Respond["lib/respond.ts"]
L_Seats["lib/seats.ts"]
end
subgraph "DB"
M_Drizzle["drizzle-activation/0000_activation_init.sql"]
end
subgraph "Config & Tests"
W_Activation["wrangler.activation.jsonc"]
W_Staging["wrangler.activation.staging.jsonc"]
V_TestCfg["vitest.activation.config.ts"]
T_Activate["test/activation/activate.test.ts"]
T_Deactivate["test/activation/deactivate.test.ts"]
T_Reactivate["test/activation/reactivate.test.ts"]
T_Admin["test/activation/admin.test.ts"]
T_DevLicense["test/activation/dev-license.test.ts"]
T_Helpers["test/activation/helpers.ts"]
T_Keys["test/activation/test-keys.ts"]
end
A_Index --> R_Activate
A_Index --> R_Deactivate
A_Index --> R_Reactivate
A_Index --> R_Status
A_Index --> R_Admin
R_Activate --> L_Key
R_Activate --> L_Lookup
R_Activate --> L_Seats
R_Activate --> L_Respond
R_Activate --> L_Authorize
R_Activate --> L_JWT
R_Deactivate --> L_Key
R_Deactivate --> L_Lookup
R_Deactivate --> L_Seats
R_Deactivate --> L_Respond
R_Deactivate --> L_Authorize
R_Reactivate --> L_Key
R_Reactivate --> L_Lookup
R_Reactivate --> L_Seats
R_Reactivate --> L_Respond
R_Reactivate --> L_Authorize
R_Status --> L_Key
R_Status --> L_Lookup
R_Status --> L_Respond
R_Admin --> L_Authorize
R_Admin --> L_Respond
A_Index --> A_Config
A_Index --> A_Schema
A_Index --> A_Types
A_Index --> A_MW
R_Activate --> M_Drizzle
R_Deactivate --> M_Drizzle
R_Reactivate --> M_Drizzle
R_Status --> M_Drizzle
R_Admin --> M_Drizzle
A_Index --> W_Activation
A_Index --> W_Staging
T_Activate --> V_TestCfg
T_Deactivate --> V_TestCfg
T_Reactivate --> V_TestCfg
T_Admin --> V_TestCfg
T_DevLicense --> V_TestCfg
```

**Diagram sources**
- [src/activation/index.ts](file://src/activation/index.ts)
- [src/activation/config.ts](file://src/activation/config.ts)
- [src/activation/schema.ts](file://src/activation/schema.ts)
- [src/activation/types.ts](file://src/activation/types.ts)
- [src/activation/middleware.ts](file://src/activation/middleware.ts)
- [src/activation/routes/activate.ts](file://src/activation/routes/activate.ts)
- [src/activation/routes/deactivate.ts](file://src/activation/routes/deactivate.ts)
- [src/activation/routes/reactivate.ts](file://src/activation/routes/reactivate.ts)
- [src/activation/routes/status.ts](file://src/activation/routes/status.ts)
- [src/activation/routes/admin.ts](file://src/activation/routes/admin.ts)
- [src/activation/lib/authorize.ts](file://src/activation/lib/authorize.ts)
- [src/activation/lib/jwt.ts](file://src/activation/lib/jwt.ts)
- [src/activation/lib/license-key.ts](file://src/activation/lib/license-key.ts)
- [src/activation/lib/license-lookup.ts](file://src/activation/lib/license-lookup.ts)
- [src/activation/lib/respond.ts](file://src/activation/lib/respond.ts)
- [src/activation/lib/seats.ts](file://src/activation/lib/seats.ts)
- [drizzle-activation/0000_activation_init.sql](file://drizzle-activation/0000_activation_init.sql)
- [wrangler.activation.jsonc](file://wrangler.activation.jsonc)
- [wrangler.activation.staging.jsonc](file://wrangler.activation.staging.jsonc)
- [vitest.activation.config.ts](file://vitest.activation.config.ts)

**Section sources**
- [src/activation/index.ts](file://src/activation/index.ts)
- [src/activation/config.ts](file://src/activation/config.ts)
- [src/activation/schema.ts](file://src/activation/schema.ts)
- [src/activation/types.ts](file://src/activation/types.ts)
- [src/activation/middleware.ts](file://src/activation/middleware.ts)
- [drizzle-activation/0000_activation_init.sql](file://drizzle-activation/0000_activation_init.sql)
- [wrangler.activation.jsonc](file://wrangler.activation.jsonc)
- [wrangler.activation.staging.jsonc](file://wrangler.activation.staging.jsonc)
- [vitest.activation.config.ts](file://vitest.activation.config.ts)

## Core Components
- Router and entrypoint: Registers activation routes and applies activation-scoped middleware.
- Configuration: Validates environment variables required for activation endpoints and JWT signing.
- Schema and types: Defines request/response shapes and internal types used across routes and libraries.
- Middleware: Authorization and request-scoped utilities tailored for activation endpoints.
- Routes: Implement activation, deactivation, reactivation, status, and administrative operations.
- Libraries:
  - Authorization: Enforces access control for admin and protected routes.
  - JWT: Issues and verifies tokens used in activation payloads.
  - License Key: Encodes/decodes and validates license keys.
  - License Lookup: Retrieves license metadata and associations.
  - Seats: Tracks and enforces seat limits per activation.
  - Respond: Standardizes success/error responses.

**Section sources**
- [src/activation/index.ts](file://src/activation/index.ts)
- [src/activation/config.ts](file://src/activation/config.ts)
- [src/activation/schema.ts](file://src/activation/schema.ts)
- [src/activation/types.ts](file://src/activation/types.ts)
- [src/activation/middleware.ts](file://src/activation/middleware.ts)
- [src/activation/lib/authorize.ts](file://src/activation/lib/authorize.ts)
- [src/activation/lib/jwt.ts](file://src/activation/lib/jwt.ts)
- [src/activation/lib/license-key.ts](file://src/activation/lib/license-key.ts)
- [src/activation/lib/license-lookup.ts](file://src/activation/lib/license-lookup.ts)
- [src/activation/lib/seats.ts](file://src/activation/lib/seats.ts)
- [src/activation/lib/respond.ts](file://src/activation/lib/respond.ts)

## Architecture Overview
The Activation System follows a layered architecture:
- HTTP layer: Hono routes handle requests and delegate to route handlers.
- Business logic: Route handlers orchestrate license key processing, seat accounting, and persistence.
- Data layer: Drizzle ORM interacts with D1 (SQLite) via migrations defined for activation.
- Security: JWT-based tokens secure activation payloads; authorization middleware protects admin routes.
- Configuration: Environment-driven settings validated on first request ensure fail-fast behavior.

```mermaid
sequenceDiagram
participant Client as "Client"
participant Hono as "Hono Router"
participant MW as "Activation Middleware"
participant Handler as "Route Handler"
participant LibKey as "license-key"
participant LibLookup as "license-lookup"
participant LibSeats as "seats"
participant DB as "D1 (Drizzle)"
participant Resp as "respond"
Client->>Hono : "POST /activate"
Hono->>MW : "Apply auth/validate"
MW-->>Hono : "Context ready"
Hono->>Handler : "Call activate handler"
Handler->>LibKey : "Validate/decode license key"
LibKey-->>Handler : "Key payload"
Handler->>LibLookup : "Resolve license details"
LibLookup->>DB : "Query license records"
DB-->>LibLookup : "License data"
Handler->>LibSeats : "Check/update seats"
LibSeats->>DB : "Persist seat changes"
DB-->>LibSeats : "Updated counts"
Handler->>Resp : "Return standardized response"
Resp-->>Client : "Activation result"
```

**Diagram sources**
- [src/activation/routes/activate.ts](file://src/activation/routes/activate.ts)
- [src/activation/lib/license-key.ts](file://src/activation/lib/license-key.ts)
- [src/activation/lib/license-lookup.ts](file://src/activation/lib/license-lookup.ts)
- [src/activation/lib/seats.ts](file://src/activation/lib/seats.ts)
- [drizzle-activation/0000_activation_init.sql](file://drizzle-activation/0000_activation_init.sql)
- [src/activation/lib/respond.ts](file://src/activation/lib/respond.ts)

## Detailed Component Analysis

### Activation Router and Entrypoint
The activation module registers all activation-related routes and wires middleware. It ensures configuration is validated early and sets up consistent error handling and logging.

```mermaid
flowchart TD
Start(["Module Init"]) --> ValidateCfg["Validate Config"]
ValidateCfg --> RegisterRoutes["Register Activation Routes"]
RegisterRoutes --> ApplyMW["Apply Middleware"]
ApplyMW --> Ready(["Ready to Serve"])
```

**Diagram sources**
- [src/activation/index.ts](file://src/activation/index.ts)
- [src/activation/config.ts](file://src/activation/config.ts)
- [src/activation/middleware.ts](file://src/activation/middleware.ts)

**Section sources**
- [src/activation/index.ts](file://src/activation/index.ts)
- [src/activation/config.ts](file://src/activation/config.ts)
- [src/activation/middleware.ts](file://src/activation/middleware.ts)

### Activate Endpoint
Handles license activation by validating the provided license key, resolving license details, enforcing seat limits, and persisting activation state.

```mermaid
sequenceDiagram
participant C as "Client"
participant R as "activate.ts"
participant K as "license-key.ts"
participant L as "license-lookup.ts"
participant S as "seats.ts"
participant D as "D1"
participant P as "respond.ts"
C->>R : "POST /activate {key, metadata}"
R->>K : "Decode and validate key"
K-->>R : "Key payload"
R->>L : "Lookup license by key"
L->>D : "SELECT license"
D-->>L : "License record"
R->>S : "Check available seats"
S->>D : "UPDATE seats"
D-->>S : "New seat count"
R->>P : "Build success response"
P-->>C : "200 OK"
```

**Diagram sources**
- [src/activation/routes/activate.ts](file://src/activation/routes/activate.ts)
- [src/activation/lib/license-key.ts](file://src/activation/lib/license-key.ts)
- [src/activation/lib/license-lookup.ts](file://src/activation/lib/license-lookup.ts)
- [src/activation/lib/seats.ts](file://src/activation/lib/seats.ts)
- [drizzle-activation/0000_activation_init.sql](file://drizzle-activation/0000_activation_init.sql)
- [src/activation/lib/respond.ts](file://src/activation/lib/respond.ts)

**Section sources**
- [src/activation/routes/activate.ts](file://src/activation/routes/activate.ts)
- [src/activation/lib/license-key.ts](file://src/activation/lib/license-key.ts)
- [src/activation/lib/license-lookup.ts](file://src/activation/lib/license-lookup.ts)
- [src/activation/lib/seats.ts](file://src/activation/lib/seats.ts)
- [src/activation/lib/respond.ts](file://src/activation/lib/respond.ts)

### Deactivate Endpoint
Processes license deactivation by verifying the license key, updating seat counts, and marking the license as deactivated.

```mermaid
flowchart TD
A["Receive Deactivate Request"] --> B["Validate Key"]
B --> C{"Key Valid?"}
C --> |No| E["Return Error"]
C --> |Yes| D["Update Seats and Status"]
D --> F["Persist Changes"]
F --> G["Return Success"]
```

**Diagram sources**
- [src/activation/routes/deactivate.ts](file://src/activation/routes/deactivate.ts)
- [src/activation/lib/license-key.ts](file://src/activation/lib/license-key.ts)
- [src/activation/lib/seats.ts](file://src/activation/lib/seats.ts)
- [src/activation/lib/respond.ts](file://src/activation/lib/respond.ts)

**Section sources**
- [src/activation/routes/deactivate.ts](file://src/activation/routes/deactivate.ts)
- [src/activation/lib/license-key.ts](file://src/activation/lib/license-key.ts)
- [src/activation/lib/seats.ts](file://src/activation/lib/seats.ts)
- [src/activation/lib/respond.ts](file://src/activation/lib/respond.ts)

### Reactivate Endpoint
Allows reactivating a previously deactivated license, ensuring the key is valid and seats are correctly restored.

```mermaid
sequenceDiagram
participant C as "Client"
participant R as "reactivate.ts"
participant K as "license-key.ts"
participant L as "license-lookup.ts"
participant S as "seats.ts"
participant D as "D1"
participant P as "respond.ts"
C->>R : "POST /reactivate {key}"
R->>K : "Validate key"
K-->>R : "Key payload"
R->>L : "Fetch license state"
L->>D : "SELECT license"
D-->>L : "License record"
R->>S : "Restore seats"
S->>D : "UPDATE seats"
D-->>S : "Updated seats"
R->>P : "Return reactivation result"
P-->>C : "200 OK"
```

**Diagram sources**
- [src/activation/routes/reactivate.ts](file://src/activation/routes/reactivate.ts)
- [src/activation/lib/license-key.ts](file://src/activation/lib/license-key.ts)
- [src/activation/lib/license-lookup.ts](file://src/activation/lib/license-lookup.ts)
- [src/activation/lib/seats.ts](file://src/activation/lib/seats.ts)
- [drizzle-activation/0000_activation_init.sql](file://drizzle-activation/0000_activation_init.sql)
- [src/activation/lib/respond.ts](file://src/activation/lib/respond.ts)

**Section sources**
- [src/activation/routes/reactivate.ts](file://src/activation/routes/reactivate.ts)
- [src/activation/lib/license-key.ts](file://src/activation/lib/license-key.ts)
- [src/activation/lib/license-lookup.ts](file://src/activation/lib/license-lookup.ts)
- [src/activation/lib/seats.ts](file://src/activation/lib/seats.ts)
- [src/activation/lib/respond.ts](file://src/activation/lib/respond.ts)

### Status Endpoint
Returns the current activation state for a given license key without mutating data.

```mermaid
flowchart TD
S0["Request /status"] --> S1["Validate Key"]
S1 --> S2{"Valid?"}
S2 --> |No| S3["Error Response"]
S2 --> |Yes| S4["Lookup License State"]
S4 --> S5["Return Status"]
```

**Diagram sources**
- [src/activation/routes/status.ts](file://src/activation/routes/status.ts)
- [src/activation/lib/license-key.ts](file://src/activation/lib/license-key.ts)
- [src/activation/lib/license-lookup.ts](file://src/activation/lib/license-lookup.ts)
- [src/activation/lib/respond.ts](file://src/activation/lib/respond.ts)

**Section sources**
- [src/activation/routes/status.ts](file://src/activation/routes/status.ts)
- [src/activation/lib/license-key.ts](file://src/activation/lib/license-key.ts)
- [src/activation/lib/license-lookup.ts](file://src/activation/lib/license-lookup.ts)
- [src/activation/lib/respond.ts](file://src/activation/lib/respond.ts)

### Admin Endpoints
Administrative operations are exposed via dedicated routes and protected by authorization middleware. These may include listing activations, forcing reactivation, or managing seat allocations.

```mermaid
sequenceDiagram
participant Admin as "Admin Client"
participant R as "admin.ts"
participant Auth as "authorize.ts"
participant P as "respond.ts"
Admin->>R : "POST /admin/*"
R->>Auth : "Verify admin token"
Auth-->>R : "Authorized"
R->>P : "Perform admin action"
P-->>Admin : "Result"
```

**Diagram sources**
- [src/activation/routes/admin.ts](file://src/activation/routes/admin.ts)
- [src/activation/lib/authorize.ts](file://src/activation/lib/authorize.ts)
- [src/activation/lib/respond.ts](file://src/activation/lib/respond.ts)

**Section sources**
- [src/activation/routes/admin.ts](file://src/activation/routes/admin.ts)
- [src/activation/lib/authorize.ts](file://src/activation/lib/authorize.ts)
- [src/activation/lib/respond.ts](file://src/activation/lib/respond.ts)

### JWT and Authorization
JWTs are used to sign activation payloads and verify authenticity. Authorization middleware enforces admin-only access for protected routes.

```mermaid
classDiagram
class JWT {
+sign(payload) string
+verify(token) object
}
class Authorize {
+requireAdmin(req) bool
+middleware(req, next) void
}
class Routes {
+activate()
+deactivate()
+reactivate()
+status()
+admin()
}
Routes --> JWT : "uses"
Routes --> Authorize : "protects"
```

**Diagram sources**
- [src/activation/lib/jwt.ts](file://src/activation/lib/jwt.ts)
- [src/activation/lib/authorize.ts](file://src/activation/lib/authorize.ts)
- [src/activation/routes/activate.ts](file://src/activation/routes/activate.ts)
- [src/activation/routes/deactivate.ts](file://src/activation/routes/deactivate.ts)
- [src/activation/routes/reactivate.ts](file://src/activation/routes/reactivate.ts)
- [src/activation/routes/status.ts](file://src/activation/routes/status.ts)
- [src/activation/routes/admin.ts](file://src/activation/routes/admin.ts)

**Section sources**
- [src/activation/lib/jwt.ts](file://src/activation/lib/jwt.ts)
- [src/activation/lib/authorize.ts](file://src/activation/lib/authorize.ts)
- [src/activation/routes/admin.ts](file://src/activation/routes/admin.ts)

### License Key Management
License keys are encoded, decoded, and validated before any activation operation. This ensures integrity and prevents tampering.

```mermaid
flowchart TD
K0["Input Key"] --> K1["Decode Key"]
K1 --> K2{"Decoded Payload Valid?"}
K2 --> |No| K3["Reject Request"]
K2 --> |Yes| K4["Proceed with Operation"]
```

**Diagram sources**
- [src/activation/lib/license-key.ts](file://src/activation/lib/license-key.ts)
- [src/activation/routes/activate.ts](file://src/activation/routes/activate.ts)
- [src/activation/routes/deactivate.ts](file://src/activation/routes/deactivate.ts)
- [src/activation/routes/reactivate.ts](file://src/activation/routes/reactivate.ts)
- [src/activation/routes/status.ts](file://src/activation/routes/status.ts)

**Section sources**
- [src/activation/lib/license-key.ts](file://src/activation/lib/license-key.ts)
- [src/activation/routes/activate.ts](file://src/activation/routes/activate.ts)
- [src/activation/routes/deactivate.ts](file://src/activation/routes/deactivate.ts)
- [src/activation/routes/reactivate.ts](file://src/activation/routes/reactivate.ts)
- [src/activation/routes/status.ts](file://src/activation/routes/status.ts)

### Seat Accounting
Seat accounting tracks how many seats are consumed by an activation and enforces limits during activation and reactivation.

```mermaid
flowchart TD
SE0["Operation"] --> SE1["Read Current Seats"]
SE1 --> SE2{"Within Limit?"}
SE2 --> |No| SE3["Return Error"]
SE2 --> |Yes| SE4["Update Seats"]
SE4 --> SE5["Persist Change"]
SE5 --> SE6["Return Success"]
```

**Diagram sources**
- [src/activation/lib/seats.ts](file://src/activation/lib/seats.ts)
- [src/activation/routes/activate.ts](file://src/activation/routes/activate.ts)
- [src/activation/routes/reactivate.ts](file://src/activation/routes/reactivate.ts)
- [drizzle-activation/0000_activation_init.sql](file://drizzle-activation/0000_activation_init.sql)

**Section sources**
- [src/activation/lib/seats.ts](file://src/activation/lib/seats.ts)
- [src/activation/routes/activate.ts](file://src/activation/routes/activate.ts)
- [src/activation/routes/reactivate.ts](file://src/activation/routes/reactivate.ts)
- [drizzle-activation/0000_activation_init.sql](file://drizzle-activation/0000_activation_init.sql)

### Database Schema and Migrations
Activation data is persisted using Drizzle ORM with SQLite-backed D1. The migration file defines the schema for licenses, seats, and related entities.

```mermaid
erDiagram
LICENSE {
uuid id PK
string key UK
int max_seats
boolean active
timestamp created_at
timestamp updated_at
}
ACTIVATION {
uuid id PK
uuid license_id FK
string client_id
int seats_used
timestamp activated_at
timestamp deactivated_at
}
LICENSE ||--o{ ACTIVATION : "has"
```

**Diagram sources**
- [drizzle-activation/0000_activation_init.sql](file://drizzle-activation/0000_activation_init.sql)

**Section sources**
- [drizzle-activation/0000_activation_init.sql](file://drizzle-activation/0000_activation_init.sql)

### Configuration and Deployment
Configuration is validated on first request to ensure required environment variables are present. Separate Wrangler profiles support development and staging deployments.

```mermaid
flowchart TD
CFG0["Start Worker"] --> CFG1["Load Env Vars"]
CFG1 --> CFG2["Validate Required Keys"]
CFG2 --> CFG3{"All Valid?"}
CFG3 --> |No| CFG4["Fail Fast"]
CFG3 --> |Yes| CFG5["Initialize Activation Module"]
```

**Diagram sources**
- [src/activation/config.ts](file://src/activation/config.ts)
- [wrangler.activation.jsonc](file://wrangler.activation.jsonc)
- [wrangler.activation.staging.jsonc](file://wrangler.activation.staging.jsonc)

**Section sources**
- [src/activation/config.ts](file://src/activation/config.ts)
- [wrangler.activation.jsonc](file://wrangler.activation.jsonc)
- [wrangler.activation.staging.jsonc](file://wrangler.activation.staging.jsonc)

### Testing Strategy
Tests cover activation, deactivation, reactivation, admin operations, and dev license scenarios. They use Vitest with Cloudflare workerd to simulate real environments.

```mermaid
flowchart TD
T0["Run Test Suite"] --> T1["Setup DB Migration"]
T1 --> T2["Execute Activation Tests"]
T2 --> T3["Execute Deactivation Tests"]
T3 --> T4["Execute Reactivation Tests"]
T4 --> T5["Execute Admin Tests"]
T5 --> T6["Execute Dev License Tests"]
T6 --> T7["Report Results"]
```

**Diagram sources**
- [vitest.activation.config.ts](file://vitest.activation.config.ts)
- [test/activation/activate.test.ts](file://test/activation/activate.test.ts)
- [test/activation/deactivate.test.ts](file://test/activation/deactivate.test.ts)
- [test/activation/reactivate.test.ts](file://test/activation/reactivate.test.ts)
- [test/activation/admin.test.ts](file://test/activation/admin.test.ts)
- [test/activation/dev-license.test.ts](file://test/activation/dev-license.test.ts)
- [test/activation/helpers.ts](file://test/activation/helpers.ts)
- [test/activation/test-keys.ts](file://test/activation/test-keys.ts)

**Section sources**
- [vitest.activation.config.ts](file://vitest.activation.config.ts)
- [test/activation/activate.test.ts](file://test/activation/activate.test.ts)
- [test/activation/deactivate.test.ts](file://test/activation/deactivate.test.ts)
- [test/activation/reactivate.test.ts](file://test/activation/reactivate.test.ts)
- [test/activation/admin.test.ts](file://test/activation/admin.test.ts)
- [test/activation/dev-license.test.ts](file://test/activation/dev-license.test.ts)
- [test/activation/helpers.ts](file://test/activation/helpers.ts)
- [test/activation/test-keys.ts](file://test/activation/test-keys.ts)

## Dependency Analysis
The Activation System exhibits clear separation of concerns:
- Routes depend on libraries for business logic (license key, lookup, seats).
- Libraries depend on Drizzle ORM for persistence.
- Authorization and JWT modules provide cross-cutting security.
- Configuration is centralized and validated early.

```mermaid
graph LR
Routes["Routes"] --> Libs["Libraries"]
Libs --> DB["D1 (Drizzle)"]
Routes --> Auth["Authorization"]
Routes --> JWT["JWT"]
Routes --> Config["Config"]
```

**Diagram sources**
- [src/activation/routes/activate.ts](file://src/activation/routes/activate.ts)
- [src/activation/routes/deactivate.ts](file://src/activation/routes/deactivate.ts)
- [src/activation/routes/reactivate.ts](file://src/activation/routes/reactivate.ts)
- [src/activation/routes/status.ts](file://src/activation/routes/status.ts)
- [src/activation/routes/admin.ts](file://src/activation/routes/admin.ts)
- [src/activation/lib/license-key.ts](file://src/activation/lib/license-key.ts)
- [src/activation/lib/license-lookup.ts](file://src/activation/lib/license-lookup.ts)
- [src/activation/lib/seats.ts](file://src/activation/lib/seats.ts)
- [src/activation/lib/authorize.ts](file://src/activation/lib/authorize.ts)
- [src/activation/lib/jwt.ts](file://src/activation/lib/jwt.ts)
- [src/activation/config.ts](file://src/activation/config.ts)

**Section sources**
- [src/activation/routes/activate.ts](file://src/activation/routes/activate.ts)
- [src/activation/routes/deactivate.ts](file://src/activation/routes/deactivate.ts)
- [src/activation/routes/reactivate.ts](file://src/activation/routes/reactivate.ts)
- [src/activation/routes/status.ts](file://src/activation/routes/status.ts)
- [src/activation/routes/admin.ts](file://src/activation/routes/admin.ts)
- [src/activation/lib/license-key.ts](file://src/activation/lib/license-key.ts)
- [src/activation/lib/license-lookup.ts](file://src/activation/lib/license-lookup.ts)
- [src/activation/lib/seats.ts](file://src/activation/lib/seats.ts)
- [src/activation/lib/authorize.ts](file://src/activation/lib/authorize.ts)
- [src/activation/lib/jwt.ts](file://src/activation/lib/jwt.ts)
- [src/activation/config.ts](file://src/activation/config.ts)

## Performance Considerations
- Minimize database round-trips by batching updates where possible.
- Cache frequently accessed license metadata if appropriate.
- Use efficient indexes on license keys and client identifiers.
- Validate inputs early to avoid unnecessary processing.
- Keep JWT payloads small to reduce overhead.

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common issues and resolutions:
- Invalid or expired license key: Ensure keys are properly generated and not tampered with.
- Seat limit exceeded: Review seat allocation and usage; consider increasing limits or freeing seats.
- Missing environment variables: Verify all required config keys are set in deployment profiles.
- Authorization failures: Confirm admin tokens are correct and authorized.
- Database errors: Check migration status and D1 connectivity.

**Section sources**
- [src/activation/lib/license-key.ts](file://src/activation/lib/license-key.ts)
- [src/activation/lib/seats.ts](file://src/activation/lib/seats.ts)
- [src/activation/config.ts](file://src/activation/config.ts)
- [src/activation/lib/authorize.ts](file://src/activation/lib/authorize.ts)
- [drizzle-activation/0000_activation_init.sql](file://drizzle-activation/0000_activation_init.sql)

## Conclusion
The Activation System provides a robust, modular implementation for managing license activations within the Trackdub platform. Its layered design, strict configuration validation, and comprehensive testing ensure reliability and maintainability. Future enhancements can focus on performance optimizations, additional admin capabilities, and expanded licensing models while preserving the current architectural integrity.

[No sources needed since this section summarizes without analyzing specific files]

## Appendices
- API Endpoints:
  - POST /activate: Activates a license with key and metadata.
  - POST /deactivate: Deactivates a license by key.
  - POST /reactivate: Reactivates a previously deactivated license.
  - GET /status: Returns activation status for a key.
  - POST /admin/*: Administrative operations requiring authorization.

[No sources needed since this section lists endpoints conceptually]