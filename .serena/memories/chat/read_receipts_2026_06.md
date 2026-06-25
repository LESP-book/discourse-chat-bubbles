# Chat Read Receipts on Discourse 2026.06

- Discourse 2026.06 `GET /chat/api/channels/:channel_id/memberships` uses `Chat::MemberListChannelMembershipSerializer`; response exposes `user` only and intentionally does not expose other users' `last_read_message_id` / `last_viewed_at`.
- `Chat::Publisher.publish_user_tracking_state!` publishes `last_read_message_id` only to `/chat/user-tracking-state/:user_id` with `user_ids: [user.id]`; it is not available to other clients over channel broadcasts.
- A theme component cannot recover true per-user read receipt avatars from frontend-only code on this Discourse version. Restoring the feature requires a server-side plugin/core change that intentionally exposes an allowed read-receipt endpoint.
- The component initializer should keep legacy compatibility for older Discourse versions where membership read state is still present, but must not fabricate read avatars when the state is absent.