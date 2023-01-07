-- Remove any references in database to slack

ALTER TABLE conversations DROP COLUMN IF EXISTS is_slack;
DROP TABLE IF EXISTS slack_oauth_access_tokens;
DROP TABLE IF EXISTS slack_users;
DROP TABLE IF EXISTS slack_user_invites;
DROP TABLE IF EXISTS slack_bot_events;