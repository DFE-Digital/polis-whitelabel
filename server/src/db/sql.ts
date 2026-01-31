import { Sql } from "sql-ts";

const sql = new Sql('postgres')

const sql_conversations = sql.define<Record<string, unknown>>({
  name: "conversations",
  columns: [
    "zid",
    "topic",
    "description",
    "participant_count",
    "is_anon",
    "is_active",
    "is_draft",
    "is_public", // TODO remove this column
    "is_data_open",
    "profanity_filter",
    "spam_filter",
    "strict_moderation",
    "email_domain",
    "owner",
    "org_id",
    "owner_sees_participation_stats",
    "context",
    "course_id",
    "lti_users_only",
    "modified",
    "created",
    "link_url",
    "parent_url",
    "vis_type",
    "write_type",
    "help_type",
    "socialbtn_type",
    "subscribe_type",
    "bgcolor",
    "help_color",
    "help_bgcolor",
    "style_btn",
    "auth_needed_to_vote",
    "auth_needed_to_write",
    "auth_opt_fb",
    "auth_opt_tw",
    "auth_opt_allow_3rdparty",
  ],
});

const sql_comments = sql.define<Record<string, unknown>>({
  name: "comments",
  columns: [
    "tid",
    "zid",
    "pid",
    "uid",
    "created",
    "txt",
    "velocity",
    "active",
    "mod",
    "quote_src_url",
    "anon",
  ],
});

const sql_votes_latest_unique = sql.define<Record<string, unknown>>({
  name: "votes_latest_unique",
  columns: ["zid", "tid", "pid", "modified", "vote"],
});

const sql_participant_metadata_answers = sql.define<Record<string, unknown>>({
  name: "participant_metadata_answers",
  columns: ["pmaid", "pmqid", "zid", "value", "alive"],
});

const sql_participants_extended = sql.define<Record<string, unknown>>({
  name: "participants_extended",
  columns: [
    "uid",
    "zid",
    "referrer",
    "parent_url",
    "created",
    "modified",

    "show_translation_activated",

    "permanent_cookie",
    "origin"
  ],
});

//first we define our tables
const sql_users = sql.define<Record<string, unknown>>({
  name: "users",
  columns: ["uid", "hname", "email", "created"],
});

const sql_reports = sql.define<Record<string, unknown>>({
  name: "reports",
  columns: [
    "rid",
    "report_id",
    "zid",
    "created",
    "modified",
    "report_name",
    "label_x_neg",
    "label_x_pos",
    "label_y_neg",
    "label_y_pos",
    "label_group_0",
    "label_group_1",
    "label_group_2",
    "label_group_3",
    "label_group_4",
    "label_group_5",
    "label_group_6",
    "label_group_7",
    "label_group_8",
    "label_group_9",
  ],
});

const { functions } = sql

export {
  sql_conversations,
  sql_comments,
  sql_votes_latest_unique,
  sql_participant_metadata_answers,
  sql_participants_extended,
  sql_reports,
  sql_users,
  functions
};

export default {
  sql_conversations,
  sql_comments,
  sql_votes_latest_unique,
  sql_participant_metadata_answers,
  sql_participants_extended,
  sql_reports,
  sql_users,
  functions
};
