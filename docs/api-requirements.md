# API Requirements

This document describes the intended behavior of the currently scaffolded API endpoints.

Base prefix: `/api/v1`

## Current scaffolded endpoints

### `POST /chat`

Purpose:

- Accept a public question
- Route it through the 3-tier chatbot decision flow

Request:

```json
{
  "message": "How do I apply for scholarship?",
  "email": "optional@student-domain"
}
```

Current behavior:

- Validates `message`
- Optionally accepts `email`
- Uses keyword-based routing in `AiRouterService`
- Returns a tier decision and next action

Target next improvements:

- Replace keyword routing with FAQ and document search
- Add confidence thresholds and source-backed responses
- Log unresolved questions for staff review

### `POST /otp/send`

Purpose:

- Start email verification for protected student actions

Request:

```json
{
  "email": "student@student.cvt.eac.edu.ph"
}
```

Current behavior:

- Validates email format
- Rejects non-allowed domains using `OSA_ALLOWED_EMAIL_DOMAIN`
- Returns a placeholder success or failure message

Target next improvements:

- Generate and persist OTP codes
- Add expiration, retry, and rate limiting
- Send mail through SMTP or Resend

### `POST /otp/verify`

Purpose:

- Verify the submitted OTP before allowing protected actions

Request:

```json
{
  "email": "student@student.cvt.eac.edu.ph",
  "otp": "123456"
}
```

Current behavior:

- Validates email and OTP format
- Returns placeholder verification success for allowed domains

Target next improvements:

- Compare against stored OTP codes
- Enforce expiry and attempt limits
- Issue a short-lived verification token or session marker

### `POST /appointments`

Purpose:

- Submit a student appointment request

Request:

```json
{
  "email": "student@student.cvt.eac.edu.ph",
  "concern": "Scholarship follow-up",
  "preferred_schedule": "2026-04-22 10:00 AM",
  "message": "Optional details"
}
```

Current behavior:

- Validates fields
- Returns the submitted payload
- Does not persist records yet

Target next improvements:

- Require successful OTP verification
- Save to `appointments` table
- Notify staff and student

### `POST /inquiries`

Purpose:

- Escalate unresolved concerns to OSA staff

Request:

```json
{
  "email": "student@student.cvt.eac.edu.ph",
  "subject": "Concern title",
  "message": "Detailed concern"
}
```

Current behavior:

- Validates fields
- Returns a generated case ID
- Does not persist records yet

Target next improvements:

- Save escalations as tickets
- Tag tier origin and status
- Support admin-side resolution workflow

### `POST /lost-found/claims`

Purpose:

- Start a claim request for a posted lost-and-found item

Request:

```json
{
  "email": "student@student.cvt.eac.edu.ph",
  "item_id": 1,
  "claim_details": "Describe the item and proof of ownership"
}
```

Current behavior:

- Validates fields
- Returns the submitted payload
- Does not persist claims yet

Target next improvements:

- Require OTP verification
- Save the claim record
- Add staff review and status tracking

## Validation and security expectations

- Protected actions should require verified school email ownership
- Inputs should use Laravel request validation
- OTP endpoints should be rate-limited
- Case creation endpoints should be logged
- Admin-only operations should be separated from public API routes

## Missing application layers needed next

The current repo already contains routes, controllers, models, views, Docker files, and environment defaults, but it still needs the standard Laravel runtime structure to become executable. The next implementation phase should add:

- `artisan`
- `bootstrap/`
- `config/`
- `database/`
- `public/`
- `resources` assets beyond Blade views
- `storage/`
- `tests/`

## Recommended implementation order

1. Complete the base Laravel application structure
2. Add migrations and seeders for services, FAQs, documents, tickets, appointments, and lost-found items
3. Replace placeholder service logic with persistent flows
4. Add admin authentication and moderation workflows
5. Connect chatbot tiers to real FAQ and document sources
