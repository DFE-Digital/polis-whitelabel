"use strict";

import AWS from "aws-sdk";
import Promise from "bluebird";
import http from "http";
import async from "async";
// @ts-ignore
import FB from "fb";
import fs from "fs";
import bcrypt from "bcryptjs";
import isTrue from "boolean";
import querystring from "querystring";
import request from "request-promise"; // includes Request, but adds promise methods
import _ from "underscore";
import pg from "pg";
import { Request, Response } from 'express'

import { METRICS_IN_RAM } from "./utils/metered";
import CreateUser from "./auth/create-user";
import Password from "./auth/password";
import dbPgQuery from "./db/pg-query";
import { generateHashedPassword } from "./auth/password";
import cookies from "./utils/cookies";
import constants from "./utils/constants";

import Config from "./config";
import Log from "./log";

import User from "./user";
import Conversation from "./conversation";
import Session from "./session";
import Comment from "./comment";
import Utils from "./utils/common";
import SQL from "./db/sql";
import emailSenders from "./email/senders";

const POLIS_FROM_ADDRESS = process.env.POLIS_FROM_ADDRESS;
const devMode = isTrue(process.env.DEV_MODE);

const adminEmailDataExport = process.env.ADMIN_EMAIL_DATA_EXPORT || "";

// @ts-ignore
const escapeLiteral = pg.Client.prototype.escapeLiteral;

import {
  addExtendedParticipantInfo,
  clearCookies,
  clearCookie,
  createNotificationsSubscribeUrl,
  createNotificationsUnsubscribeUrl,
  deleteFacebookUserRecord,
  do_handle_POST_auth_facebook,
  doAddDataExportTask,
  doGetConversationsRecent,
  emailBadProblemTime,
  emailFeatureRequest,
  finishArray,
  getBidIndexToPidMapping,
  getDemographicsForVotersOnComments,
  getDomainWhitelist,
  getFirstForPid,
  getFriends,
  getLocationInfo,
  getParticipant,
  getPca,
  getUidByEmail,
  getXids,
  getZidForRid,
  hashStringToInt32,
  HMAC_SIGNATURE_PARAM_NAME,
  isModerator,
  isOwner,
  joinConversation,
  populateParticipantLocationRecordIfPossible,
  prepForQuoteWithTwitterUser,
  prepForTwitterComment,
  recordPermanentCookieZidJoin,
  sendPasswordResetEmail,
  sendPasswordResetEmailFailure,
  setDomainWhitelist,
  startSessionAndAddCookies,
  subscribeToNotifications,
  unsubscribeFromNotifications,
  updateLastInteractionTimeForConversation,
  userHasAnsweredZeQuestions,
  verifyHmacForQueryParams,
  addNotificationTask,
  addParticipant,
  addParticipantAndMetadata,
  commentExists,
  finishOne,
  getNumberOfCommentsWithModerationStatus,
  getVotesForSingleParticipant,
  hasBadWords,
  isSpam,
  joinWithZidOrSuzinvite,
  sendCommentModerationEmail,
  updateConversationModifiedTime,
  updateVoteCount,
  votesPost,
  addCanvasAssignmentConversationCallbackParamsIfNeeded,
  addCanvasAssignmentConversationInfoIfNeeded,
  addInviter,
  addNoMoreCommentsRecord,
  addStar,
  browserSupportsPushState,
  buildConversationDemoUrl,
  buildConversationUrl,
  buildModerationUrl,
  buildSeedUrl,
  createReport,
  deleteMetadataAnswer,
  fetchIndexForReportPage,
  fetchIndexForAdminPage,
  deleteMetadataQuestionAndAnswers,
  doFamousQuery,
  doGetConversationPreloadInfo,
  doSendEinvite,
  emailTeam,
  encodeParams,
  failWithRetryRequest,
  generateAndReplaceZinvite,
  generateSUZinvites,
  getCanvasAssignmentInfo,
  getChoicesForConversation,
  getConversations,
  getConversationUrl,
  getLocationsForParticipants,
  getNextComment,
  getOneConversation,
  getParticipantDemographicsForConversation,
  getParticipantVotesForCommentsFlaggedWith_is_meta,
  getPidsForGid,
  getSocialParticipantsForMod_timed,
  getTwitterAccessToken,
  getTwitterRequestToken,
  getTwitterUserInfo,
  getZidForAnswer,
  getZidForQuestion,
  getZinvite,
  hasAuthToken,
  hostname,
  ifDefinedSet,
  initializeImplicitConversation,
  isConversationOwner,
  isDuplicateKey,
  isOwnerOrParticipant,
  isPolisDev,
  isUserAllowedToCreateConversations,
  makeFileFetcher,
  moderateComment,
  portForParticipationFiles,
  postMessageUsingHttp,
  proxy,
  pullFbTwIntoSubObjects,
  pullXInfoIntoSubObjects,
  removeNullOrUndefinedProperties,
  renderLtiLinkagePage,
  retryFunctionWithPromise,
  sendCanvasGradesIfNeeded,
  sendEmailByUid,
  sendImplicitConversationCreatedEmails,
  sendSuzinviteEmail,
  switchToUser,
  updateLocalRecordsToReflectPostedGrades,
  verifyMetadataAnswersExistForEachQuestion,
} from "./helpers";

import {
  Headers,
  ParticipantInfo,
  PidReadyResult,
  CommentOptions,
  ParticipantFields,
  ParticipantCommentModerationResult,
  UserType,
  ConversationType,
  CommentType,
  TwitterParameters,
  DemographicEntry,
  SlackUser,
  Vote,
} from "./d";

const s3Client = new AWS.S3({ apiVersion: "2006-03-01" });

function handle_GET_launchPrep(
  req: {
    headers?: { origin: string };
    cookies: { [x: string]: any };
    p: { dest: any };
  },
  res: { redirect: (arg0: any) => void }
) {
  let setOnPolisDomain = !Config.domainOverride;
  let origin = req?.headers?.origin || "";
  if (setOnPolisDomain && origin.match(/^http:\/\/localhost:[0-9]{4}/)) {
    setOnPolisDomain = false;
  }

  if (!req.cookies[cookies.COOKIES.PERMANENT_COOKIE]) {
    cookies.setPermanentCookie(
      req,
      res,
      setOnPolisDomain,
      Session.makeSessionToken()
    );
  }
  cookies.setCookieTestCookie(req, res, setOnPolisDomain);

  // Argument of type '{ redirect: (arg0: any) => void; }' is not assignable to parameter of type '{ cookie: (arg0: any, arg1: any, arg2: any) => void; }'.
  // Property 'cookie' is missing in type '{ redirect: (arg0: any) => void; }' but required in type '{ cookie: (arg0: any, arg1: any, arg2: any) => void; }'.ts(2345)
  // @ts-ignore
  setCookie(req, res, setOnPolisDomain, "top", "ok", {
    httpOnly: false, // not httpOnly - needed by JS
  });

  // using hex since it doesn't require escaping like base64.
  let dest = Utils.hexToStr(req.p.dest);
  res.redirect(dest);
}

function handle_GET_tryCookie(
  req: { headers?: { origin: string }; cookies: { [x: string]: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: {}): void; new (): any };
    };
  }
) {
  let setOnPolisDomain = !Config.domainOverride;
  let origin = req?.headers?.origin || "";
  if (setOnPolisDomain && origin.match(/^http:\/\/localhost:[0-9]{4}/)) {
    setOnPolisDomain = false;
  }

  if (!req.cookies[cookies.COOKIES.TRY_COOKIE]) {
    // Argument of type '{ status: (arg0: number) => { (): any; new (): any; json:
    // { (arg0: {}): void; new (): any; }; }; }' is not assignable to parameter of type
    // '{ cookie: (arg0: any, arg1: any, arg2: any) => void; }'.
    //   Property 'cookie' is missing in type '{ status: (arg0: number) =>
    // { (): any; new (): any; json: { (arg0: {}): void; new (): any; }; };
    // } ' but required in type '{ cookie: (arg0: any, arg1: any, arg2: any) => void; } '.ts(2345)
    // @ts-ignore
    setCookie(req, res, setOnPolisDomain, cookies.COOKIES.TRY_COOKIE, "ok", {
      httpOnly: false, // not httpOnly - needed by JS
    });
  }
  res.status(200).json({});
}

function handle_GET_math_pca(
  req: any,
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      end: { (): void; new (): any };
    };
  }
) {
  // migrated off this path, old clients were causing timeout issues by polling repeatedly without waiting for a result for a previous poll.
  res.status(304).end();
}

// Cache the knowledge of whether there are any pca results for a given zid.
// Needed to determine whether to return a 404 or a 304.
// zid -> boolean
let pcaResultsExistForZid = {};
function handle_GET_math_pca2(
  req: { p: { zid: any; math_tick: any; ifNoneMatch: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      end: { (): void; new (): any };
    };
    set: (arg0: {
      "Content-Type": string;
      "Content-Encoding": string;
      Etag: string;
    }) => void;
    send: (arg0: any) => void;
  }
) {
  let zid = req.p.zid;
  let math_tick = req.p.math_tick;

  let ifNoneMatch = req.p.ifNoneMatch;
  if (ifNoneMatch) {
    if (!_.isUndefined(math_tick)) {
      return Log.fail(
        res,
        400,
        "Expected either math_tick param or If-Not-Match header, but not both."
      );
    }
    if (ifNoneMatch.includes("*")) {
      math_tick = 0;
    } else {
      let entries = ifNoneMatch.split(/ *, */).map((x: string) => {
        return Number(
          x
            .replace(/^[wW]\//, "")
            .replace(/^"/, "")
            .replace(/"$/, "")
        );
      });
      math_tick = _.min(entries); // supporting multiple values for the ifNoneMatch header doesn't really make sense, so I've arbitrarily chosen _.min to decide on one.
    }
  } else if (_.isUndefined(math_tick)) {
    math_tick = -1;
  }
  function finishWith304or404() {
    // Element implicitly has an 'any' type
    // because expression of type 'any' can't be used to index type '{ } '.ts(7053)
    // @ts-ignore
    if (pcaResultsExistForZid[zid]) {
      res.status(304).end();
    } else {
      res.status(304).end();
      // res.status(404).end();
    }
  }

  getPca(zid, math_tick)
    .then(function (data: {
      asPOJO: { math_tick: string };
      asBufferOfGzippedJson: any;
    }) {
      if (data) {
        // The buffer is gzipped beforehand to cut down on server effort in re-gzipping the same json string for each response.
        // We can't cache this endpoint on Cloudflare because the response changes too freqently, so it seems like the best way
        // is to cache the gzipped json'd buffer here on the server.
        res.set({
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
          Etag: '"' + data.asPOJO.math_tick + '"',
        });
        res.send(data.asBufferOfGzippedJson);
      } else {
        // check whether we should return a 304 or a 404
        // Element implicitly has an 'any' type
        // because expression of type 'any' can't be used to index type '{ } '.ts(7053)
        // @ts-ignore
        if (_.isUndefined(pcaResultsExistForZid[zid])) {
          // This server doesn't know yet if there are any PCA results in the DB
          // So try querying from -1
          return getPca(zid, -1).then(function (data: any) {
            let exists = !!data;
            // Element implicitly has an 'any' type
            // because expression of type 'any' can't be used to index type '{ } '.ts(7053)
            // @ts-ignore
            pcaResultsExistForZid[zid] = exists;
            finishWith304or404();
          });
        } else {
          finishWith304or404();
        }
      }
    })
    .catch(function (err: any) {
      Log.fail(res, 500, err);
    });
}

function handle_POST_math_update(
  req: { p: { zid: any; uid?: any; math_update_type: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: {}): void; new (): any };
    };
  }
) {
  let zid = req.p.zid;
  let uid = req.p.uid;
  let math_env = process.env.MATH_ENV;
  let math_update_type = req.p.math_update_type;

  isModerator(zid, uid).then((hasPermission: any) => {
    if (!hasPermission) {
      return Log.fail(res, 500, "handle_POST_math_update_permission");
    }
    return dbPgQuery
      .queryP(
        "insert into worker_tasks (task_type, task_data, task_bucket, math_env) values ('update_math', $1, $2, $3);",
        [
          JSON.stringify({
            zid: zid,
            math_update_type: math_update_type,
          }),
          zid,
          math_env,
        ]
      )
      .then(() => {
        res.status(200).json({});
      })
      .catch((err: any) => {
        return Log.fail(res, 500, "polis_err_POST_math_update", err);
      });
  });
}

function handle_GET_math_correlationMatrix(
  req: { p: { rid: any; math_tick: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: { status: string }): void; new (): any };
    };
    json: (arg0: any) => void;
  }
) {
  let rid = req.p.rid;
  let math_env = process.env.MATH_ENV;
  let math_tick = req.p.math_tick;

  console.log(req.p);
  function finishAsPending() {
    res.status(202).json({
      status: "pending",
    });
  }

  function hasCommentSelections() {
    return (
      dbPgQuery
        .queryP(
          "select * from report_comment_selections where rid = ($1) and selection = 1;",
          [rid]
        )
        // Argument of type '(rows: string | any[]) => boolean' is not assignable to parameter of type '(value: unknown) => boolean | PromiseLike<boolean>'.
        // Types of parameters 'rows' and 'value' are incompatible.
        // Type 'unknown' is not assignable to type 'string | any[]'.
        //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
        // @ts-ignore
        .then((rows: string | any[]) => {
          return rows.length > 0;
        })
    );
  }

  let requestExistsPromise = dbPgQuery.queryP(
    "select * from worker_tasks where task_type = 'generate_report_data' and math_env=($2) " +
      "and task_bucket = ($1) " +
      // "and attempts < 3 " +
      "and (task_data->>'math_tick')::int >= ($3) " +
      "and finished_time is NULL;",
    [rid, math_env, math_tick]
  );

  let resultExistsPromise = dbPgQuery.queryP(
    "select * from math_report_correlationmatrix where rid = ($1) and math_env = ($2) and math_tick >= ($3);",
    [rid, math_env, math_tick]
  );

  Promise.all([resultExistsPromise, getZidForRid(rid)])
    .then((a: any[]) => {
      let rows = a[0];
      let zid = a[1];
      if (!rows || !rows.length) {
        //         Argument of type '(requests_rows: string | any[]) => globalThis.Promise<void> | undefined' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void | undefined> | undefined'.
        // Types of parameters 'requests_rows' and 'value' are incompatible.
        //   Type 'unknown' is not assignable to type 'string | any[]'.
        //           Type 'unknown' is not assignable to type 'any[]'.ts(2345)
        // @ts-ignore
        return requestExistsPromise.then((requests_rows: string | any[]) => {
          const shouldAddTask = !requests_rows || !requests_rows.length;
          // const shouldAddTask = true;

          if (shouldAddTask) {
            return hasCommentSelections().then((hasSelections: any) => {
              if (!hasSelections) {
                return res.status(202).json({
                  status: "polis_report_needs_comment_selection",
                });
              }
              return dbPgQuery
                .queryP(
                  "insert into worker_tasks (task_type, task_data, task_bucket, math_env) values ('generate_report_data', $1, $2, $3);",
                  [
                    JSON.stringify({
                      rid: rid,
                      zid: zid,
                      math_tick: math_tick,
                    }),
                    rid,
                    math_env,
                  ]
                )
                .then(finishAsPending);
            });
          }
          finishAsPending();
        });
      }
      res.json(rows[0].data);
    })
    .catch((err: any) => {
      return Log.fail(res, 500, "polis_err_GET_math_correlationMatrix", err);
    });
}

function handle_GET_dataExport(
  req: { p: { uid?: any; zid: any; unixTimestamp: number; format: any } },
  res: { json: (arg0: {}) => void }
) {
  User.getUserInfoForUid2(req.p.uid)
    .then((user: { email: any }) => {
      return doAddDataExportTask(
        process.env.MATH_ENV,
        user.email,
        req.p.zid,
        req.p.unixTimestamp * 1000,
        req.p.format,
        Math.abs((Math.random() * 999999999999) >> 0)
      )
        .then(() => {
          res.json({});
        })
        .catch((err: any) => {
          Log.fail(res, 500, "polis_err_data_export123", err);
        });
    })
    .catch((err: any) => {
      Log.fail(res, 500, "polis_err_data_export123b", err);
    });
}
function handle_GET_dataExport_results(
  req: { p: { filename: string } },
  res: { redirect: (arg0: any) => void }
) {
  var url = s3Client.getSignedUrl("getObject", {
    Bucket: "polis-datadump",
    Key: process.env.MATH_ENV + "/" + req.p.filename,
    Expires: 60 * 60 * 24 * 7,
  });
  res.redirect(url);
}

function handle_GET_bidToPid(
  req: { p: { zid: any; math_tick: any } },
  res: {
    json: (arg0: { bidToPid: any }) => void;
    status: (arg0: number) => {
      (): any;
      new (): any;
      end: { (): void; new (): any };
    };
  }
) {
  let zid = req.p.zid;
  let math_tick = req.p.math_tick;
  getBidIndexToPidMapping(zid, math_tick).then(
    function (doc: { bidToPid: any }) {
      let b2p = doc.bidToPid;
      res.json({
        bidToPid: b2p,
      });
    },
    function (err: any) {
      res.status(304).end();
    }
  );
}

function handle_GET_xids(
  req: { p: { uid?: any; zid: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: any): void; new (): any };
    };
  }
) {
  let uid = req.p.uid;
  let zid = req.p.zid;

  isOwner(zid, uid).then(
    function (owner: any) {
      if (owner) {
        getXids(zid).then(
          function (xids: any) {
            res.status(200).json(xids);
          },
          function (err: any) {
            Log.fail(res, 500, "polis_err_get_xids", err);
          }
        );
      } else {
        Log.fail(res, 403, "polis_err_get_xids_not_authorized");
      }
    },
    function (err: any) {
      Log.fail(res, 500, "polis_err_get_xids", err);
    }
  );
}
function handle_POST_xidWhitelist(
  req: { p: { xid_whitelist: any; uid?: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: {}): void; new (): any };
    };
  }
) {
  const xid_whitelist = req.p.xid_whitelist;
  const len = xid_whitelist.length;
  const owner = req.p.uid;
  const entries = [];
  try {
    for (var i = 0; i < len; i++) {
      entries.push("(" + escapeLiteral(xid_whitelist[i]) + "," + owner + ")");
    }
  } catch (err) {
    return Log.fail(res, 400, "polis_err_bad_xid", err);
  }

  dbPgQuery
    .queryP(
      "insert into xid_whitelist (xid, owner) values " +
        entries.join(",") +
        " on conflict do nothing;",
      []
    )
    .then((result: any) => {
      res.status(200).json({});
    })
    .catch((err: any) => {
      return Log.fail(res, 500, "polis_err_POST_xidWhitelist", err);
    });
}

function handle_GET_bid(
  req: { p: { uid?: any; zid: any; math_tick: any } },
  res: {
    json: (arg0: { bid: any }) => void;
    status: (arg0: number) => {
      (): any;
      new (): any;
      end: { (): void; new (): any };
    };
  }
) {
  let uid = req.p.uid;
  let zid = req.p.zid;
  let math_tick = req.p.math_tick;

  let dataPromise = getBidIndexToPidMapping(zid, math_tick);
  let pidPromise = User.getPidPromise(zid, uid);
  let mathResultsPromise = getPca(zid, math_tick);

  Promise.all([dataPromise, pidPromise, mathResultsPromise])
    .then(
      function (items: { asPOJO: any }[]) {
        // Property 'bidToPid' does not exist on type '{ asPOJO: any; }'.ts(2339)
        // @ts-ignore
        let b2p = items[0].bidToPid || []; // not sure yet if "|| []" is right here.
        let pid = items[1];
        let mathResults = items[2].asPOJO;
        if ((pid as unknown as number) < 0) {
          // NOTE: this API should not be called in /demo mode
          Log.fail(res, 500, "polis_err_get_bid_bad_pid");
          return;
        }

        let indexToBid = mathResults["base-clusters"].id;

        let yourBidi = -1;
        for (var bidi = 0; bidi < b2p.length; bidi++) {
          let pids = b2p[bidi];
          if (pids.indexOf(pid) !== -1) {
            yourBidi = bidi;
            break;
          }
        }

        let yourBid = indexToBid[yourBidi];

        if (yourBidi >= 0 && _.isUndefined(yourBid)) {
          console.error(
            "polis_err_math_index_mapping_mismatch",
            "pid was",
            pid,
            "bidToPid was",
            JSON.stringify(b2p)
          );
          Log.yell("polis_err_math_index_mapping_mismatch");
          yourBid = -1;
        }

        res.json({
          bid: yourBid, // The user's current bid
        });
      },
      function (err: any) {
        res.status(304).end();
      }
    )
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_get_bid_misc", err);
    });
}

function handle_POST_auth_password(
  req: { p: { pwresettoken: any; newPassword: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: string): void; new (): any };
    };
  }
) {
  let pwresettoken = req.p.pwresettoken;
  let newPassword = req.p.newPassword;

  Session.getUidForPwResetToken(
    pwresettoken,
    //     Argument of type '(err: any, userParams: { uid?: any; }) => void' is not assignable to parameter of type '(arg0: number | null, arg1?: { uid: any; } | undefined) => void'.
    // Types of parameters 'userParams' and 'arg1' are incompatible.
    //   Type '{ uid: any; } | undefined' is not assignable to type '{ uid?: any; }'.
    //     Type 'undefined' is not assignable to type '{ uid?: any; }'.ts(2345)
    // @ts-ignore
    function (err: any, userParams: { uid?: any }) {
      if (err) {
        console.error(err);
        Log.fail(
          res,
          500,
          "Password Reset failed. Couldn't find matching pwresettoken.",
          err
        );
        return;
      }
      let uid = Number(userParams.uid);
      generateHashedPassword(
        newPassword,
        function (err: any, hashedPassword: any) {
          return dbPgQuery
            .queryP(
              "insert into jianiuevyew (uid, pwhash) values " +
                "($1, $2) on conflict (uid) " +
                "do update set pwhash = excluded.pwhash;",
              [uid, hashedPassword]
            )
            .then(
              (rows: any) => {
                res.status(200).json("Password reset successful.");
                Session.clearPwResetToken(pwresettoken, function (err: any) {
                  if (err) {
                    Log.yell(err);
                    console.error("polis_err_auth_pwresettoken_clear_fail");
                  }
                });
              },
              (err: any) => {
                console.error(err);
                Log.fail(res, 500, "Couldn't reset password.", err);
              }
            );
        }
      );
    }
  );
}

function handle_POST_auth_slack_redirect_uri(
  req: { p: { code: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      send: { (arg0: string): void; new (): any };
    };
  }
) {
  const code = req.p.code;
  console.log("handle_POST_auth_slack_redirect_uri 1");

  console.log(process.env.POLIS_SLACK_APP_CLIENT_ID);

  request
    .get(
      "https://slack.com/api/oauth.access?" +
        querystring.stringify({
          client_id: process.env.POLIS_SLACK_APP_CLIENT_ID,
          client_secret: process.env.POLIS_SLACK_APP_CLIENT_SECRET,
          code: code,
          redirect_uri:
            Config.getServerNameWithProtocol(req) +
            "/api/v3/auth/slack/redirect_uri",
        })
    )
    .then((slackResponse: string) => {
      const parsedSlackResponse = JSON.parse(slackResponse);
      if (parsedSlackResponse && parsedSlackResponse.ok === false) {
        Log.fail(res, 500, "polis_err_slack_oauth 3", parsedSlackResponse);
        return;
      }
      console.log("handle_POST_auth_slack_redirect_uri 2");
      console.log(parsedSlackResponse);
      return dbPgQuery
        .queryP(
          "insert into slack_oauth_access_tokens (slack_access_token, slack_scope, slack_auth_response) values ($1, $2, $3);",
          [
            parsedSlackResponse.access_token,
            parsedSlackResponse.scope,
            parsedSlackResponse,
            // state,
          ]
        )
        .then(() => {
          res.status(200).send("");
        });
    })
    .catch((err: any) => {
      Log.fail(res, 500, "polis_err_slack_oauth", err);
    });
}
function handle_POST_auth_pwresettoken(
  req: { p: { email: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: string): void; new (): any };
    };
  }
) {
  let email = req.p.email;

  let server = Config.getServerNameWithProtocol(req);

  // let's clear the cookies here, in case something is borked.
  clearCookies(req, res);

  function finish() {
    res.status(200).json("Password reset email sent, please check your email.");
  }

  getUidByEmail(email).then(
    function (uid?: any) {
      Session.setupPwReset(uid, function (err: any, pwresettoken: any) {
        sendPasswordResetEmail(uid, pwresettoken, server, function (err: any) {
          if (err) {
            console.error(err);
            Log.fail(res, 500, "Error: Couldn't send password reset email.");
            return;
          }
          finish();
        });
      });
    },
    function () {
      sendPasswordResetEmailFailure(email, server);
      finish();
    }
  );
}

function handle_POST_auth_deregister(
  req: { p: { showPage?: any }; cookies: { [x: string]: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      end: { (): void; new (): any };
      send: { (arg0: string): void; new (): any };
    };
    set: (arg0: { "Content-Type": string }) => void;
  }
) {
  req.p = req.p || {};
  let token = req.cookies[cookies.COOKIES.TOKEN];

  // clear cookies regardless of auth status
  clearCookies(req, res);

  function finish() {
    if (!req.p.showPage) {
      res.status(200).end();
    } else if (req.p.showPage === "canvas_assignment_deregister") {
      res.set({
        "Content-Type": "text/html",
      });
      let html = `<!DOCTYPE html><html lang='en'>
<body>
<h1>You are now signed out of pol.is</h1>
<p>Please return to the 'setup pol.is' assignment to sign in as another user.</p>
</body></html>`;
      res.status(200).send(html);
    }
  }
  if (!token) {
    // nothing to do
    return finish();
  }
  Session.endSession(token, function (err: any, data: any) {
    if (err) {
      Log.fail(res, 500, "couldn't end session", err);
      return;
    }
    finish();
  });
}

function handle_POST_metrics(
  req: {
    cookies: { [x: string]: any };
    p: {
      uid: null;
      durs: any[];
      clientTimestamp: any;
      times: any[];
      types: any[];
    };
  },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: {}): any; new (): any };
    };
    json: (arg0: {}) => void;
  }
) {
  var enabled = false;
  if (!enabled) {
    return res.status(200).json({});
  }

  const pc = req.cookies[cookies.COOKIES.PERMANENT_COOKIE];
  const hashedPc = hashStringToInt32(pc);

  const uid = req.p.uid || null;
  const durs = req.p.durs.map(function (dur: number | null) {
    if (dur === -1) {
      dur = null;
    }
    return dur;
  });
  const clientTimestamp = req.p.clientTimestamp;
  const ages = req.p.times.map(function (t: number) {
    return clientTimestamp - t;
  });
  const now = Date.now();
  const timesInTermsOfServerTime = ages.map(function (a: number) {
    return now - a;
  });
  const len = timesInTermsOfServerTime.length;
  const entries = [];
  for (var i = 0; i < len; i++) {
    entries.push(
      "(" +
        [
          uid || "null",
          req.p.types[i],
          durs[i],
          hashedPc,
          timesInTermsOfServerTime[i],
        ].join(",") +
        ")"
    );
  }

  dbPgQuery
    .queryP(
      "insert into metrics (uid, type, dur, hashedPc, created) values " +
        entries.join(",") +
        ";",
      []
    )
    .then(function (result: any) {
      res.json({});
    })
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_metrics_post", err);
    });
}

function handle_GET_zinvites(
  req: { p: { zid: any; uid?: any } },
  res: {
    writeHead: (arg0: number) => void;
    json: (arg0: { status: number }) => void;
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: { codes: any }): void; new (): any };
    };
  }
) {
  // if uid is not conversation owner, Log.fail
  dbPgQuery.query_readOnly(
    "SELECT * FROM conversations WHERE zid = ($1) AND owner = ($2);",
    [req.p.zid, req.p.uid],
    function (err: any, results: { rows: any }) {
      if (err) {
        Log.fail(
          res,
          500,
          "polis_err_fetching_zinvite_invalid_conversation_or_owner",
          err
        );
        return;
      }
      if (!results || !results.rows) {
        res.writeHead(404);
        res.json({
          status: 404,
        });
        return;
      }
      dbPgQuery.query_readOnly(
        "SELECT * FROM zinvites WHERE zid = ($1);",
        [req.p.zid],
        function (err: any, results: { rows: any }) {
          if (err) {
            Log.fail(
              res,
              500,
              "polis_err_fetching_zinvite_invalid_conversation_or_owner_or_something",
              err
            );
            return;
          }
          if (!results || !results.rows) {
            res.writeHead(404);
            res.json({
              status: 404,
            });
            return;
          }
          res.status(200).json({
            codes: results.rows, // _.pluck(results.rows[0],"code");
          });
        }
      );
    }
  );
}

function handle_POST_zinvites(
  req: { p: { short_url: any; zid: any; uid?: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: { zinvite: any }): void; new (): any };
    };
  }
) {
  let generateShortUrl = req.p.short_url;

  dbPgQuery.query(
    "SELECT * FROM conversations WHERE zid = ($1) AND owner = ($2);",
    [req.p.zid, req.p.uid],
    function (err: any, results: any) {
      if (err) {
        Log.fail(
          res,
          500,
          "polis_err_creating_zinvite_invalid_conversation_or_owner",
          err
        );
        return;
      }

      CreateUser.generateAndRegisterZinvite(req.p.zid, generateShortUrl)
        .then(function (zinvite: any) {
          res.status(200).json({
            zinvite: zinvite,
          });
        })
        .catch(function (err: any) {
          Log.fail(res, 500, "polis_err_creating_zinvite", err);
        });
    }
  );
}

function handle_GET_participants(
  req: { p: { uid?: any; zid: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: any): void; new (): any };
    };
  }
) {
  // let pid = req.p.pid;
  let uid = req.p.uid;
  let zid = req.p.zid;

  dbPgQuery
    .queryP_readOnly(
      "select * from participants where uid = ($1) and zid = ($2)",
      [uid, zid]
    )
    //     Argument of type '(rows: string | any[]) => void' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.
    // Types of parameters 'rows' and 'value' are incompatible.
    //   Type 'unknown' is not assignable to type 'string | any[]'.
    //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
    // @ts-ignore
    .then(function (rows: string | any[]) {
      let ptpt = (rows && rows.length && rows[0]) || null;
      res.status(200).json(ptpt);
    })
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_get_participant", err);
    });
}
function handle_GET_dummyButton(
  req: { p: { button: string; uid: string } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      end: { (): void; new (): any };
    };
  }
) {
  let message = req.p.button + " " + req.p.uid;
  emailFeatureRequest(message);
  res.status(200).end();
}

function handle_GET_conversationsRecentlyStarted(req: any, res: any) {
  doGetConversationsRecent(req, res, "created");
}

function handle_GET_conversationsRecentActivity(req: any, res: any) {
  doGetConversationsRecent(req, res, "modified");
}

function handle_POST_participants(
  req: {
    p: { zid: any; uid?: any; answers: any; parent_url: any; referrer: any };
    cookies: { [x: string]: any };
  },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: any): void; new (): any };
    };
  }
) {
  let zid = req.p.zid;
  let uid = req.p.uid;
  let answers = req.p.answers;
  let info: ParticipantInfo = {};

  let parent_url = req.cookies[cookies.COOKIES.PARENT_URL] || req.p.parent_url;
  let referrer = req.cookies[cookies.COOKIES.PARENT_REFERRER] || req.p.referrer;

  if (parent_url) {
    info.parent_url = parent_url;
  }
  if (referrer) {
    info.referrer = referrer;
  }

  function finish(ptpt: any) {
    // Probably don't need pid cookies..?
    // function getZidToPidCookieKey(zid) {
    //     return zid + "p";
    // }
    // addCookie(res, getZidToPidCookieKey(zid), pid);

    clearCookie(req, res, cookies.COOKIES.PARENT_URL);
    clearCookie(req, res, cookies.COOKIES.PARENT_REFERRER);

    setTimeout(function () {
      updateLastInteractionTimeForConversation(zid, uid);
    }, 0);
    res.status(200).json(ptpt);
  }

  function doJoin() {
    userHasAnsweredZeQuestions(zid, answers).then(
      function () {
        joinConversation(zid, uid, info, answers).then(
          function (ptpt: any) {
            finish(ptpt);
          },
          function (err: any) {
            Log.fail(res, 500, "polis_err_add_participant", err);
          }
        );
      },
      function (err: { message: any }) {
        Log.userFail(res, 400, err.message, err);
      }
    );
  }

  // Check if already in the conversation
  getParticipant(zid, req.p.uid)
    .then(
      function (ptpt: { pid: any }) {
        if (ptpt) {
          finish(ptpt);

          // populate their location if needed - no need to wait on this.
          populateParticipantLocationRecordIfPossible(zid, req.p.uid, ptpt.pid);
          addExtendedParticipantInfo(zid, req.p.uid, info);
          return;
        }

        Conversation.getConversationInfo(zid)
          .then(function (conv: { lti_users_only: any }) {
            if (conv.lti_users_only) {
              if (uid) {
                dbPgQuery
                  .queryP("select * from lti_users where uid = ($1)", [uid])
                  // Argument of type '(rows: string | any[]) => void' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.
                  // Types of parameters 'rows' and 'value' are incompatible.
                  //   Type 'unknown' is not assignable to type 'string | any[]'.
                  //    Type 'unknown' is not assignable to type 'any[]'.ts(2345)
                  // @ts-ignore
                  .then(function (rows: string | any[]) {
                    if (rows && rows.length) {
                      // found a record in lti_users
                      doJoin();
                    } else {
                      Log.userFail(
                        res,
                        403,
                        "polis_err_post_participants_missing_lti_user_for_uid_1"
                      );
                    }
                  })
                  .catch(function (err: any) {
                    Log.fail(
                      res,
                      500,
                      "polis_err_post_participants_missing_lti_user_for_uid_2",
                      err
                    );
                  });
              } else {
                Log.userFail(
                  res,
                  403,
                  "polis_err_post_participants_need_uid_to_check_lti_users_3"
                );
              }
            } else {
              // no LTI stuff to worry about
              doJoin();
            }
          })
          .catch(function (err: any) {
            Log.fail(
              res,
              500,
              "polis_err_post_participants_need_uid_to_check_lti_users_4",
              err
            );
          });
      },
      function (err: any) {
        Log.fail(res, 500, "polis_err_post_participants_db_err", err);
      }
    )
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_post_participants_misc", err);
    });
}

function handle_GET_notifications_subscribe(
  req: {
    p: { [x: string]: any; zid: any; email: any; conversation_id: any };
  },
  res: {
    set: (arg0: string, arg1: string) => void;
    send: (arg0: string) => void;
  }
) {
  let zid = req.p.zid;
  let email = req.p.email;
  let params = {
    conversation_id: req.p.conversation_id,
    email: req.p.email,
  };
  // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
  // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
  // @ts-ignore
  params[HMAC_SIGNATURE_PARAM_NAME] = req.p[HMAC_SIGNATURE_PARAM_NAME];
  verifyHmacForQueryParams("api/v3/notifications/subscribe", params)
    .then(
      function () {
        return dbPgQuery
          .queryP(
            "update participants set subscribed = 1 where uid = (select uid from users where email = ($2)) and zid = ($1);",
            [zid, email]
          )
          .then(function () {
            res.set("Content-Type", "text/html");
            res.send(
              `<h1>Subscribed!</h1>
<p>
<a href="${createNotificationsUnsubscribeUrl(
                req.p.conversation_id,
                req.p.email
              )}">oops, unsubscribe me.</a>
</p>`
            );
          });
      },
      function () {
        Log.fail(res, 403, "polis_err_subscribe_signature_mismatch");
      }
    )
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_subscribe_misc", err);
    });
}
function handle_GET_notifications_unsubscribe(
  req: {
    p: { [x: string]: any; zid: any; email: any; conversation_id: any };
  },
  res: {
    set: (arg0: string, arg1: string) => void;
    send: (arg0: string) => void;
  }
) {
  let zid = req.p.zid;
  let email = req.p.email;
  let params = {
    conversation_id: req.p.conversation_id,
    email: email,
  };
  // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
  // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
  // @ts-ignore
  params[HMAC_SIGNATURE_PARAM_NAME] = req.p[HMAC_SIGNATURE_PARAM_NAME];
  verifyHmacForQueryParams("api/v3/notifications/unsubscribe", params)
    .then(
      function () {
        return dbPgQuery
          .queryP(
            "update participants set subscribed = 0 where uid = (select uid from users where email = ($2)) and zid = ($1);",
            [zid, email]
          )
          .then(function () {
            res.set("Content-Type", "text/html");
            res.send(
              `<h1>Unsubscribed.</h1>
<p>
<a href="${createNotificationsSubscribeUrl(
                req.p.conversation_id,
                req.p.email
              )}">oops, subscribe me again.</a>
</p>`
            );
          });
      },
      function () {
        Log.fail(res, 403, "polis_err_unsubscribe_signature_mismatch");
      }
    )
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_unsubscribe_misc", err);
    });
}
function handle_POST_convSubscriptions(
  req: { p: { zid: any; uid?: any; type: any; email: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: { subscribed: any }): void; new (): any };
    };
  }
) {
  let zid = req.p.zid;
  let uid = req.p.uid;
  let type = req.p.type;

  let email = req.p.email;

  function finish(type: any) {
    res.status(200).json({
      subscribed: type,
    });
  }

  if (type === 1) {
    subscribeToNotifications(zid, uid, email)
      .then(finish)
      .catch(function (err: any) {
        Log.fail(res, 500, "polis_err_sub_conv " + zid + " " + uid, err);
      });
  } else if (type === 0) {
    unsubscribeFromNotifications(zid, uid)
      .then(finish)
      .catch(function (err: any) {
        Log.fail(res, 500, "polis_err_unsub_conv " + zid + " " + uid, err);
      });
  } else {
    Log.fail(
      res,
      400,
      "polis_err_bad_subscription_type",
      new Error("polis_err_bad_subscription_type")
    );
  }
}

function handle_POST_auth_login(
  req: {
    p: {
      password: any;
      email: string;
      lti_user_id: any;
      lti_user_image: any;
      lti_context_id: any;
      tool_consumer_instance_guid?: any;
      afterJoinRedirectUrl: any;
    };
  },
  res: {
    redirect: (arg0: any) => void;
    json: (arg0: { uid?: any; email: any; token: any }) => void;
  }
) {
  let password = req.p.password;
  let email = req.p.email || "";
  let lti_user_id = req.p.lti_user_id;
  let lti_user_image = req.p.lti_user_image;
  let lti_context_id = req.p.lti_context_id;
  let tool_consumer_instance_guid = req.p.tool_consumer_instance_guid;
  let afterJoinRedirectUrl = req.p.afterJoinRedirectUrl;

  email = email.toLowerCase();
  if (!_.isString(password) || !password.length) {
    Log.fail(res, 403, "polis_err_login_need_password");
    return;
  }
  dbPgQuery.query(
    "SELECT * FROM users WHERE LOWER(email) = ($1);",
    [email],
    function (err: any, docs: { rows?: any[] }) {
      const { rows } = docs;
      if (err) {
        Log.fail(res, 403, "polis_err_login_unknown_user_or_password", err);
        console.error("polis_err_login_unknown_user_or_password_err");
        return;
      }
      if (!rows || rows.length === 0) {
        Log.fail(
          res,
          403,
          "polis_err_login_unknown_user_or_password_noresults"
        );
        console.error("polis_err_login_unknown_user_or_password_noresults");
        return;
      }

      let uid = rows[0].uid;

      dbPgQuery.query(
        "select pwhash from jianiuevyew where uid = ($1);",
        [uid],
        function (err: any, results: { rows: any[] }) {
          // results: { pwhash: any }[]
          const { rows } = results;
          if (err) {
            Log.fail(res, 403, "polis_err_login_unknown_user_or_password", err);
            console.error("polis_err_login_unknown_user_or_password_err");
            return;
          }
          if (!results || rows.length === 0) {
            Log.fail(res, 403, "polis_err_login_unknown_user_or_password");
            console.error("polis_err_login_unknown_user_or_password_noresults");
            return;
          }

          let hashedPassword = rows[0].pwhash;

          bcrypt.compare(
            password,
            hashedPassword,
            function (errCompare: any, result: any) {
              console.log("info", "errCompare, result", errCompare, result);
              if (errCompare || !result) {
                Log.fail(res, 403, "polis_err_login_unknown_user_or_password");
                console.error(
                  "polis_err_login_unknown_user_or_password_badpassword"
                );
                return;
              }

              Session.startSession(uid, function (errSess: any, token: any) {
                let response_data = {
                  uid: uid,
                  email: email,
                  token: token,
                };
                cookies
                  // Argument of type '{ p: { password: any; email: string; lti_user_id: any; lti_user_image: any;
                  // lti_context_id: any; tool_consumer_instance_guid?: any; afterJoinRedirectUrl: any; }; }' is not assignable to parameter of type
                  // '{ cookies: { [x: string]: any; }; }'.
                  //  Property 'cookies' is missing in type '{ p: { password: any; email: string; lti_user_id: any;
                  // lti_user_image: any; lti_context_id: any; tool_consumer_instance_guid?: any; afterJoinRedirectUrl: any; }; }' but required in type
                  // '{ cookies: { [x: string]: any; }; }'.ts(2345)
                  // @ts-ignore
                  .addCookies(req, res, token, uid)
                  .then(function () {
                    console.log("info", "uid", uid);
                    console.log("info", "lti_user_id", lti_user_id);
                    console.log("info", "lti_context_id", lti_context_id);
                    let ltiUserPromise = lti_user_id
                      ? User.addLtiUserIfNeeded(
                          uid,
                          lti_user_id,
                          tool_consumer_instance_guid,
                          lti_user_image
                        )
                      : Promise.resolve();
                    let ltiContextMembershipPromise = lti_context_id
                      ? User.addLtiContextMembership(
                          uid,
                          lti_context_id,
                          tool_consumer_instance_guid
                        )
                      : Promise.resolve();
                    Promise.all([ltiUserPromise, ltiContextMembershipPromise])
                      .then(function () {
                        if (lti_user_id) {
                          if (afterJoinRedirectUrl) {
                            res.redirect(afterJoinRedirectUrl);
                          } else {
                            // Argument of type '{ redirect: (arg0: any) => void; json: (arg0: { uid?: any; email: any; token: any; }) => void; }'
                            // is not assignable to parameter of type '{ set: (arg0: { "Content-Type": string; }) => void; status:
                            // (arg0: number) => { (): any; new (): any; send: { (arg0: string): void; new (): any; }; }; }'.
                            // Type '{ redirect: (arg0: any) => void; json: (arg0: { uid?: any; email: any; token: any; }) => void; }'
                            // is missing the following properties from type '{ set: (arg0: { "Content-Type": string; }) => void;
                            // status: (arg0: number) => { (): any; new (): any; send: { (arg0: string): void; new (): any; }; }; }': set, statusts(2345)
                            // @ts-ignore
                            User.renderLtiLinkageSuccessPage(req, res, {
                              // may include token here too
                              context_id: lti_context_id,
                              uid: uid,
                              // hname: hname,
                              email: email,
                            });
                          }
                        } else {
                          res.json(response_data);
                        }
                      })
                      .catch(function (err: any) {
                        Log.fail(
                          res,
                          500,
                          "polis_err_adding_associating_with_lti_user",
                          err
                        );
                      });
                  })
                  .catch(function (err: any) {
                    Log.fail(res, 500, "polis_err_adding_cookies", err);
                  });
              }); // Session.startSession
            }
          ); // compare
        }
      ); // pwhash query
    }
  ); // users query
} // /api/v3/auth/login

function handle_POST_joinWithInvite(
  req: {
    p: {
      answers: any;
      uid?: any;
      suzinvite: any;
      permanentCookieToken: any;
      zid: any;
      referrer: any;
      parent_url: any;
    };
  },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: { pid: any; uid?: any }): void; new (): any };
    };
  }
) {
  // if they're already in the conv
  //     this shouldn't get called
  // else
  //     not in conv.
  //     need to join
  //     has their permanentCookieToken already joined?
  //         do they have an email attached?
  //              hmm weird.. what to do?
  //         else
  //              force them to create a full account
  //     else
  //         let them join without forcing a sign in (assuming conversation allows that)

  return (
    joinWithZidOrSuzinvite({
      answers: req.p.answers,
      existingAuth: !!req.p.uid,
      suzinvite: req.p.suzinvite,
      permanentCookieToken: req.p.permanentCookieToken,
      uid: req.p.uid,
      zid: req.p.zid, // since the zid is looked up using the conversation_id, it's safe to use zid as an invite token. TODO huh?
      referrer: req.p.referrer,
      parent_url: req.p.parent_url,
    })
      //     No overload matches this call.
      // Overload 1 of 2, '(onFulfill?: ((value: unknown) => Resolvable<{ uid?: any; existingAuth: string; }>) | undefined, onReject?: ((error: any) => Resolvable<{ uid?: any; existingAuth: string; }>) | undefined): Bluebird<...>', gave the following error.
      //   Argument of type '(o: { uid?: any; existingAuth: string; }) => Bluebird<{ uid?: any; existingAuth: string; }>' is not assignable to parameter of type '(value: unknown) => Resolvable<{ uid?: any; existingAuth: string; }>'.
      //     Types of parameters 'o' and 'value' are incompatible.
      //       Type 'unknown' is not assignable to type '{ uid?: any; existingAuth: string; }'.
      // Overload 2 of 2, '(onfulfilled?: ((value: unknown) => Resolvable<{ uid?: any; existingAuth: string; }>) | null | undefined, onrejected?: ((reason: any) => PromiseLike<never>) | null | undefined): Bluebird<...>', gave the following error.
      //   Argument of type '(o: { uid?: any; existingAuth: string; }) => Bluebird<{ uid?: any; existingAuth: string; }>' is not assignable to parameter of type '(value: unknown) => Resolvable<{ uid?: any; existingAuth: string; }>'.
      //     Types of parameters 'o' and 'value' are incompatible.
      //     Type 'unknown' is not assignable to type '{ uid?: any; existingAuth: string; }'.ts(2769)
      // @ts-ignore
      .then(function (o: { uid?: any; existingAuth: string }) {
        let uid = o.uid;
        console.log(
          "info",
          "startSessionAndAddCookies " + uid + " existing " + o.existingAuth
        );
        // TODO check for possible security implications
        if (!o.existingAuth) {
          return startSessionAndAddCookies(req, res, uid).then(function () {
            return o;
          });
        }
        return Promise.resolve(o);
      })
      //       No overload matches this call.
      // Overload 1 of 2, '(onFulfill?: ((value: unknown) => Resolvable<{ permanentCookieToken: any; zid: any; }>) | undefined,
      //  onReject ?: ((error: any) => Resolvable<{ permanentCookieToken: any; zid: any; }>) | undefined): Bluebird <...> ', gave the following error.
      //   Argument of type '(o: { permanentCookieToken: any; zid: any; }) => { permanentCookieToken: any; zid: any; } |
      // Promise < { permanentCookieToken: any; zid: any; } > ' is not assignable to parameter of type '(value: unknown) => Resolvable < { permanentCookieToken: any; zid: any; } > '.
      //     Types of parameters 'o' and 'value' are incompatible.
      //       Type 'unknown' is not assignable to type '{ permanentCookieToken: any; zid: any; }'.
      // Overload 2 of 2, '(onfulfilled?: ((value: unknown) => Resolvable<{ permanentCookieToken: any; zid: any; }>) |
      //  null | undefined, onrejected ?: ((reason: any) => PromiseLike<never>) | null | undefined): Bluebird <...> ', gave the following error.
      //   Argument of type '(o: { permanentCookieToken: any; zid: any; }) => { permanentCookieToken: any; zid: any; } |
      // Promise < { permanentCookieToken: any; zid: any; } > ' is not assignable to parameter of type '(value: unknown) => Resolvable < { permanentCookieToken: any; zid: any; } > '.
      //     Types of parameters 'o' and 'value' are incompatible.
      //     Type 'unknown' is not assignable to type '{ permanentCookieToken: any; zid: any; }'.ts(2769)
      // @ts-ignore
      .then(function (o: { permanentCookieToken: any; zid: any }) {
        console.log("info", "permanentCookieToken", o.permanentCookieToken);
        if (o.permanentCookieToken) {
          return recordPermanentCookieZidJoin(
            o.permanentCookieToken,
            o.zid
          ).then(
            function () {
              return o;
            },
            function () {
              return o;
            }
          );
        } else {
          return o;
        }
      })
      //       No overload matches this call.
      // Overload 1 of 2, '(onFulfill?: ((value: unknown) => Resolvable<void>) | undefined, onReject?: ((error: any) => Resolvable<void>) | undefined): Bluebird<void>', gave the following error.
      //   Argument of type '(o: { pid: any; }) => void' is not assignable to parameter of type '(value: unknown) => Resolvable<void>'.
      //     Types of parameters 'o' and 'value' are incompatible.
      //       Type 'unknown' is not assignable to type '{ pid: any; }'.
      // Overload 2 of 2, '(onfulfilled?: ((value: unknown) => Resolvable<void>) | null | undefined, onrejected?: ((reason: any) => PromiseLike<never>) | null | undefined): Bluebird<void>', gave the following error.
      //   Argument of type '(o: { pid: any; }) => void' is not assignable to parameter of type '(value: unknown) => Resolvable<void>'.
      //     Types of parameters 'o' and 'value' are incompatible.
      //     Type 'unknown' is not assignable to type '{ pid: any; }'.ts(2769)
      // @ts-ignore
      .then(function (o: { pid: any }) {
        let pid = o.pid;
        res.status(200).json({
          pid: pid,
          uid: req.p.uid,
        });
      })
      .catch(function (err: { message: string }) {
        if (
          err &&
          err.message &&
          err.message.match(/polis_err_need_full_user/)
        ) {
          Log.userFail(res, 403, err.message, err);
        } else if (err && err.message) {
          Log.fail(res, 500, err.message, err);
        } else if (err) {
          Log.fail(res, 500, "polis_err_joinWithZidOrSuzinvite", err);
        } else {
          Log.fail(res, 500, "polis_err_joinWithZidOrSuzinvite");
        }
      })
  );
}

function handle_GET_verification(
  req: { p: { e: any } },
  res: {
    set: (arg0: string, arg1: string) => void;
    send: (arg0: string) => void;
  }
) {
  let einvite = req.p.e;
  dbPgQuery
    .queryP("select * from einvites where einvite = ($1);", [einvite])
    //     Argument of type '(rows: string | any[]) => Promise<unknown>' is not assignable to parameter of type '(value: unknown) => unknown'.
    // Types of parameters 'rows' and 'value' are incompatible.
    //   Type 'unknown' is not assignable to type 'string | any[]'.
    //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
    // @ts-ignore
    .then(function (rows: string | any[]) {
      if (!rows.length) {
        Log.fail(res, 500, "polis_err_verification_missing");
      }
      let email = rows[0].email;
      return (
        dbPgQuery
          .queryP("select email from email_validations where email = ($1);", [
            email,
          ])
          //         Argument of type '(rows: string | any[]) => true | Promise<unknown>' is not assignable to parameter of type '(value: unknown) => unknown'.
          // Types of parameters 'rows' and 'value' are incompatible.
          //   Type 'unknown' is not assignable to type 'string | any[]'.
          //         Type 'unknown' is not assignable to type 'any[]'.ts(2345)
          // @ts-ignore
          .then(function (rows: string | any[]) {
            if (rows && rows.length > 0) {
              return true;
            }
            return dbPgQuery.queryP(
              "insert into email_validations (email) values ($1);",
              [email]
            );
          })
      );
    })
    .then(function () {
      res.set("Content-Type", "text/html");
      res.send(
        `<html><body>
<div style='font-family: Futura, Helvetica, sans-serif;'>
Email verified! You can close this tab or hit the back button.
</div>
</body></html>`
      );
    })
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_verification", err);
    });
}

function handle_GET_domainWhitelist(
  req: { p: { uid?: any } },
  res: { json: (arg0: { domain_whitelist: any }) => void }
) {
  getDomainWhitelist(req.p.uid)
    .then(function (whitelist: any) {
      res.json({
        domain_whitelist: whitelist,
      });
    })
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_get_domainWhitelist_misc", err);
    });
}
function handle_POST_domainWhitelist(
  req: { p: { uid?: any; domain_whitelist: any } },
  res: { json: (arg0: { domain_whitelist: any }) => void }
) {
  setDomainWhitelist(req.p.uid, req.p.domain_whitelist)
    .then(function () {
      res.json({
        domain_whitelist: req.p.domain_whitelist,
      });
    })
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_post_domainWhitelist_misc", err);
    });
}
function handle_GET_conversationStats(
  req: { p: { zid: any; uid?: any; until: any; rid: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: {
        (arg0: {
          voteTimes: any;
          firstVoteTimes: any[];
          commentTimes: any;
          firstCommentTimes: any[];
          votesHistogram: any;
          burstHistogram: any[];
        }): void;
        new (): any;
      };
    };
  }
) {
  let zid = req.p.zid;
  let uid = req.p.uid;
  let until = req.p.until;

  let hasPermission = req.p.rid
    ? Promise.resolve(!!req.p.rid)
    : isModerator(zid, uid);

  hasPermission
    .then(function (ok: any) {
      if (!ok) {
        Log.fail(
          res,
          403,
          "polis_err_conversationStats_need_report_id_or_moderation_permission"
        );
        return;
      }

      let args = [zid];

      let q0 = until
        ? "select created, pid, mod from comments where zid = ($1) and created < ($2) order by created;"
        : "select created, pid, mod from comments where zid = ($1) order by created;";

      let q1 = until
        ? "select created, pid from votes where zid = ($1) and created < ($2) order by created;"
        : "select created, pid from votes where zid = ($1) order by created;";

      if (until) {
        args.push(until);
      }

      return Promise.all([
        dbPgQuery.queryP_readOnly(q0, args),
        dbPgQuery.queryP_readOnly(q1, args),
      ]).then(function (a: any[]) {
        function castTimestamp(o: { created: number }) {
          o.created = Number(o.created);
          return o;
        }
        let comments = _.map(a[0], castTimestamp);
        let votes = _.map(a[1], castTimestamp);

        let votesGroupedByPid = _.groupBy(votes, "pid");
        let votesHistogramObj = {};
        _.each(
          votesGroupedByPid,
          function (votesByParticipant: string | any[], pid: any) {
            // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
            // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
            // @ts-ignore
            votesHistogramObj[votesByParticipant.length] =
              // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
              // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
              // @ts-ignore
              votesHistogramObj[votesByParticipant.length] + 1 || 1;
          }
        );
        let votesHistogram: { n_votes: any; n_ptpts: any }[] = [];
        _.each(votesHistogramObj, function (ptptCount: any, voteCount: any) {
          votesHistogram.push({
            n_votes: voteCount,
            n_ptpts: ptptCount,
          });
        });
        votesHistogram.sort(function (a, b) {
          return a.n_ptpts - b.n_ptpts;
        });

        let burstsForPid = {};
        let interBurstGap = 10 * 60 * 1000; // a 10 minute gap between votes counts as a gap between bursts
        _.each(
          votesGroupedByPid,
          function (votesByParticipant: string | any[], pid: string | number) {
            // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
            // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
            // @ts-ignore
            burstsForPid[pid] = 1;
            let prevCreated = votesByParticipant.length
              ? votesByParticipant[0]
              : 0;
            for (var v = 1; v < votesByParticipant.length; v++) {
              let vote = votesByParticipant[v];
              if (interBurstGap + prevCreated < vote.created) {
                // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
                // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
                // @ts-ignore
                burstsForPid[pid] += 1;
              }
              prevCreated = vote.created;
            }
          }
        );
        let burstHistogramObj = {};
        //         Argument of type '(bursts: string | number, pid: any) => void' is not assignable to parameter of type 'CollectionIterator<unknown, void, {}>'.
        // Types of parameters 'bursts' and 'element' are incompatible.
        //   Type 'unknown' is not assignable to type 'string | number'.
        //           Type 'unknown' is not assignable to type 'number'.ts(2345)
        // @ts-ignore
        _.each(burstsForPid, function (bursts: string | number, pid: any) {
          // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
          // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
          // @ts-ignore
          burstHistogramObj[bursts] = burstHistogramObj[bursts] + 1 || 1;
        });
        let burstHistogram: { n_ptpts: any; n_bursts: number }[] = [];
        _.each(burstHistogramObj, function (ptptCount: any, burstCount: any) {
          burstHistogram.push({
            n_ptpts: ptptCount,
            n_bursts: Number(burstCount),
          });
        });
        burstHistogram.sort(function (a, b) {
          return a.n_bursts - b.n_bursts;
        });

        let actualParticipants = getFirstForPid(votes); // since an agree vote is submitted for each comment's author, this includes people who only wrote a comment, but didn't explicitly vote.
        actualParticipants = _.pluck(actualParticipants, "created");
        let commenters = getFirstForPid(comments);
        commenters = _.pluck(commenters, "created");

        let totalComments = _.pluck(comments, "created");
        let totalVotes = _.pluck(votes, "created");

        votesHistogram = _.map(
          votesHistogram,
          function (x: { n_votes: any; n_ptpts: any }) {
            return {
              n_votes: Number(x.n_votes),
              n_ptpts: Number(x.n_ptpts),
            };
          }
        );

        res.status(200).json({
          voteTimes: totalVotes,
          firstVoteTimes: actualParticipants,
          commentTimes: totalComments,
          firstCommentTimes: commenters,
          votesHistogram: votesHistogram,
          burstHistogram: burstHistogram,
        });
      });
    })
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_conversationStats_misc", err);
    });
}
function handle_GET_snapshot(
  req: { p: { uid?: any; zid: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: {
        (arg0: { zid: any; zinvite: any; url: string }): void;
        new (): any;
      };
    };
  }
) {
  throw new Error(
    "TODO Needs to clone participants_extended and any other new tables as well."
  );
}
function handle_GET_facebook_delete(
  req: { p: any },
  res: { json: (arg0: {}) => void }
) {
  deleteFacebookUserRecord(req.p)
    .then(function () {
      res.json({});
    })
    .catch(function (err: any) {
      Log.fail(res, 500, err);
    });
}

function handle_GET_perfStats(req: any, res: { json: (arg0: any) => void }) {
  res.json(METRICS_IN_RAM);
}

function handle_POST_auth_facebook(
  req: {
    p: {
      response?: string;
      locationInfo?: any;
      fb_friends_response?: string;
    };
    headers?: { referer: string };
    cookies?: any;
  },
  res: any
) {
  let response = JSON.parse(req?.p?.response || "");
  let fb_access_token =
    response && response.authResponse && response.authResponse.accessToken;
  if (!fb_access_token) {
    emailBadProblemTime(
      "polis_err_missing_fb_access_token " +
        req?.headers?.referer +
        "\n\n" +
        req.p.response
    );
    console.log(req.p.response);
    console.log(JSON.stringify(req.headers));
    Log.fail(res, 500, "polis_err_missing_fb_access_token");
    return;
  }
  let fields = [
    "email",
    "first_name",
    "friends",
    "gender",
    "id",
    "is_verified",
    "last_name",
    "link",
    "locale",
    "location",
    "name",
    "timezone",
    "updated_time",
    "verified",
  ];

  FB.setAccessToken(fb_access_token);
  FB.api(
    "me",
    {
      fields: fields,
    },
    function (fbRes: { error: any; friends: string | any[]; location: any }) {
      if (!fbRes || fbRes.error) {
        Log.fail(res, 500, "polis_err_fb_auth_check", fbRes && fbRes.error);
        return;
      }

      const friendsPromise =
        fbRes && fbRes.friends && fbRes.friends.length
          ? getFriends(fb_access_token)
          : Promise.resolve([]);

      Promise.all([
        getLocationInfo(fb_access_token, fbRes.location),
        friendsPromise,
      ]).then(function (a: any[]) {
        let locationResponse = a[0];
        let friends = a[1];

        if (locationResponse) {
          req.p.locationInfo = locationResponse;
        }
        if (friends) {
          req.p.fb_friends_response = JSON.stringify(friends);
        }
        response.locationInfo = locationResponse;
        do_handle_POST_auth_facebook(req, res, {
          locationInfo: locationResponse,
          friends: friends,
          info: _.pick(fbRes, fields),
        });
      });
    }
  );
}

function handle_POST_auth_new(req: any, res: any) {
  CreateUser.createUser(req, res);
} // end /api/v3/auth/new

function handle_POST_tutorial(
  req: { p: { uid?: any; step: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: {}): void; new (): any };
    };
  }
) {
  let uid = req.p.uid;
  let step = req.p.step;
  dbPgQuery
    .queryP("update users set tut = ($1) where uid = ($2);", [step, uid])
    .then(function () {
      res.status(200).json({});
    })
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_saving_tutorial_state", err);
    });
}

function handle_GET_users(
  req: { p: { uid?: any; errIfNoAuth: any; xid: any; owner_uid?: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: any): void; new (): any };
    };
  }
) {
  let uid = req.p.uid;

  if (req.p.errIfNoAuth && !uid) {
    Log.fail(res, 401, "polis_error_auth_needed");
    return;
  }

  User.getUser(uid, null, req.p.xid, req.p.owner_uid)
    .then(
      function (user: any) {
        res.status(200).json(user);
      },
      function (err: any) {
        Log.fail(res, 500, "polis_err_getting_user_info2", err);
      }
    )
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_getting_user_info", err);
    });
}

/*
  Rename column 'zid' to 'conversation_id', add a new column called 'zid' and have that be a VARCHAR of limited length.
  Use conversation_id internally, refactor math poller to use conversation_id
  continue to use zid externally, but it will be a string of limited length
  Don't expose the conversation_id to the client.

  plan:
  add the new column conversation_id, copy values from zid
  change the code to look things up by conversation_id

*/

function handle_GET_participation(
  req: { p: { zid: any; uid?: any; strict: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: {}): void; new (): any };
    };
  }
) {
  let zid = req.p.zid;
  let uid = req.p.uid;
  let strict = req.p.strict;
  isOwner(zid, uid)
    .then(function (ok: any) {
      if (!ok) {
        Log.fail(res, 403, "polis_err_get_participation_auth");
        return;
      }

      return Promise.all([
        dbPgQuery.queryP_readOnly(
          "select pid, count(*) from votes where zid = ($1) group by pid;",
          [zid]
        ),
        dbPgQuery.queryP_readOnly(
          "select pid, count(*) from comments where zid = ($1) group by pid;",
          [zid]
        ),
        getXids(zid), //dbPgQuery.queryP_readOnly("select pid, xid from xids inner join (select * from participants where zid = ($1)) as p on xids.uid = p.uid;", [zid]),
      ]).then(function (o: any[]) {
        let voteCountRows = o[0];
        let commentCountRows = o[1];
        let pidXidRows = o[2];
        let i, r;

        if (strict && !pidXidRows.length) {
          Log.fail(
            res,
            409,
            "polis_err_get_participation_missing_xids This conversation has no xids for its participants."
          );
          return;
        }

        // Build a map like this {xid -> {votes: 10, comments: 2}}
        //           (property) votes: number
        // 'new' expression, whose target lacks a construct signature, implicitly has an 'any' type.ts(7009)
        // @ts-ignore
        let result = new DD(function () {
          return {
            votes: 0,
            comments: 0,
          };
        });

        // Count votes
        for (i = 0; i < voteCountRows.length; i++) {
          r = voteCountRows[i];
          result.g(r.pid).votes = Number(r.count);
        }
        // Count comments
        for (i = 0; i < commentCountRows.length; i++) {
          r = commentCountRows[i];
          result.g(r.pid).comments = Number(r.count);
        }

        // convert from DD to POJO
        result = result.m;

        if (pidXidRows && pidXidRows.length) {
          // Convert from {pid -> foo} to {xid -> foo}
          let pidToXid = {};
          for (i = 0; i < pidXidRows.length; i++) {
            // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
            // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
            // @ts-ignore
            pidToXid[pidXidRows[i].pid] = pidXidRows[i].xid;
          }
          let xidBasedResult = {};
          let size = 0;
          _.each(result, function (val: any, key: string | number) {
            // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
            // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
            // @ts-ignore
            xidBasedResult[pidToXid[key]] = val;
            size += 1;
          });

          if (
            strict &&
            (commentCountRows.length || voteCountRows.length) &&
            size > 0
          ) {
            Log.fail(
              res,
              409,
              "polis_err_get_participation_missing_xids This conversation is missing xids for some of its participants."
            );
            return;
          }
          res.status(200).json(xidBasedResult);
        } else {
          res.status(200).json(result);
        }
      });
    })
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_get_participation_misc", err);
    });
}

function handle_GET_comments_translations(
  req: { p: { zid: any; tid: any; lang: string } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: any): void; new (): any };
    };
  }
) {
  const zid = req.p.zid;
  const tid = req.p.tid;
  const firstTwoCharsOfLang = req.p.lang.substr(0, 2);

  Comment.getComment(zid, tid)
    //   Argument of type '(comment: {    txt: any;}) => globalThis.Promise<void>' is not assignable to parameter of type '(value: Row) => void | PromiseLike<void>'.
    // Types of parameters 'comment' and 'value' are incompatible.
    //   Property 'txt' is missing in type 'Row' but required in type '{ txt: any; }'.ts(2345)
    // @ts-ignore
    .then((comment: { txt: any }) => {
      return dbPgQuery
        .queryP(
          "select * from comment_translations where zid = ($1) and tid = ($2) and lang LIKE '$3%';",
          [zid, tid, firstTwoCharsOfLang]
        )
        .then((existingTranslations: any) => {
          if (existingTranslations) {
            return existingTranslations;
          }
          return Comment.translateAndStoreComment(
            zid,
            tid,
            comment.txt,
            req.p.lang
          );
        })
        .then((rows: any) => {
          res.status(200).json(rows || []);
        });
    })
    .catch((err: any) => {
      Log.fail(res, 500, "polis_err_get_comments_translations", err);
    });
}

function handle_GET_comments(
  req: {
    headers?: Headers;
    p: { rid: any; include_demographics: any; zid: any; uid?: any };
  },
  res: any
) {
  const rid =
    req?.headers?.["x-request-id"] + " " + req?.headers?.["user-agent"];
  console.log("info", "getComments " + rid + " begin");

  const isReportQuery = !_.isUndefined(req.p.rid);

  // Argument of type '{ rid: any; include_demographics: any; zid: any; uid?: any; }' is not assignable to parameter of type 'O'.
  //   Type '{ rid: any; include_demographics: any; zid: any; uid?: any; }' is missing the following properties from type 'O': include_voting_patterns, modIn, pid, tids, and 9 more.ts(2345)
  // @ts-ignore
  Comment.getComments(req.p)
    .then(function (comments: any[]) {
      if (req.p.rid) {
        return dbPgQuery
          .queryP(
            "select tid, selection from report_comment_selections where rid = ($1);",
            [req.p.rid]
          )
          .then((selections: any) => {
            let tidToSelection = _.indexBy(selections, "tid");
            comments = comments.map(
              (c: { includeInReport: any; tid: string | number }) => {
                c.includeInReport =
                  tidToSelection[c.tid] && tidToSelection[c.tid].selection > 0;
                return c;
              }
            );
            return comments;
          });
      } else {
        return comments;
      }
    })
    .then(function (comments: any[]) {
      comments = comments.map(function (c: {
        social: {
          twitter_user_id: string;
          twitter_profile_image_url_https: string;
          fb_user_id: any;
          fb_picture: string;
        };
      }) {
        let hasTwitter = c.social && c.social.twitter_user_id;
        if (hasTwitter) {
          c.social.twitter_profile_image_url_https =
            Config.getServerNameWithProtocol(req) +
            "/twitter_image?id=" +
            c.social.twitter_user_id;
        }
        let hasFacebook = c.social && c.social.fb_user_id;
        if (hasFacebook) {
          let width = 40;
          let height = 40;
          c.social.fb_picture = `https://graph.facebook.com/v2.2/${c.social.fb_user_id}/picture?width=${width}&height=${height}`;
        }
        return c;
      });

      if (req.p.include_demographics) {
        isModerator(req.p.zid, req.p.uid)
          .then((owner: any) => {
            if (owner || isReportQuery) {
              return getDemographicsForVotersOnComments(req.p.zid, comments)
                .then((commentsWithDemographics: any) => {
                  finishArray(res, commentsWithDemographics);
                })
                .catch((err: any) => {
                  Log.fail(res, 500, "polis_err_get_comments3", err);
                });
            } else {
              Log.fail(res, 500, "polis_err_get_comments_permissions");
            }
          })
          .catch((err: any) => {
            Log.fail(res, 500, "polis_err_get_comments2", err);
          });
      } else {
        finishArray(res, comments);
      }
    })
    .catch(function (err: any) {
      console.log("info", "getComments " + rid + " failed");
      Log.fail(res, 500, "polis_err_get_comments", err);
    });
} // end GET /api/v3/comments

function handle_POST_comments_slack(
  req: {
    p: SlackUser;
  },
  res: any
) {
  const slack_team = req.p.slack_team;
  const slack_user_id = req.p.slack_user_id;
  dbPgQuery
    .queryP(
      "select * from slack_users where slack_team = ($1) and slack_user_id = ($2);",
      [slack_team, slack_user_id]
    )
    //     Argument of type '(rows: string | any[]) => any' is not assignable to parameter of type '(value: unknown) => any'.
    // Types of parameters 'rows' and 'value' are incompatible.
    //   Type 'unknown' is not assignable to type 'string | any[]'.
    //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
    // @ts-ignore
    .then((rows: string | any[]) => {
      if (!rows || !rows.length) {
        const uidPromise = User.createDummyUser();
        return uidPromise.then((uid?: any) => {
          return dbPgQuery.queryP(
            "insert into slack_users (uid, slack_team, slack_user_id) values ($1, $2, $3) returning *;",
            [uid, slack_team, slack_user_id]
          );
        });
      }
      return rows;
    })
    .then((slack_user_rows: any) => {
      return User.getPidPromise(req.p.zid, req.p.uid, true).then(
        (pid: number) => {
          if (pid >= 0) {
            req.p.pid = pid;
          }
          return slack_user_rows;
        }
      );
    })
    .then((slack_user_rows: string | any[]) => {
      if (!slack_user_rows || !slack_user_rows.length) {
        Log.fail(res, 500, "polis_err_post_comments_slack_missing_slack_user");
      }
      const uid = slack_user_rows[0].uid;
      req.p.uid = uid;

      handle_POST_comments(req, res);
    })
    .catch((err: any) => {
      Log.fail(res, 500, "polis_err_post_comments_slack_misc", err);
    });
}

function handle_POST_comments(
  req: {
    p: {
      zid?: any;
      uid?: any;
      txt?: any;
      pid?: any;
      vote?: any;
      twitter_tweet_id?: any;
      quote_twitter_screen_name?: any;
      quote_txt?: any;
      quote_src_url?: any;
      anon?: any;
      is_seed?: any;
    };
    headers?: Headers;
    connection?: { remoteAddress: any; socket: { remoteAddress: any } };
    socket?: { remoteAddress: any };
  },
  res: { json: (arg0: { tid: any; currentPid: any }) => void }
) {
  let zid = req.p.zid;
  let xid = void 0; //req.p.xid;
  let uid = req.p.uid;
  let txt = req.p.txt;
  let pid = req.p.pid; // PID_FLOW may be undefined
  let currentPid = pid;
  let vote = req.p.vote;
  let twitter_tweet_id = req.p.twitter_tweet_id;
  let quote_twitter_screen_name = req.p.quote_twitter_screen_name;
  let quote_txt = req.p.quote_txt;
  let quote_src_url = req.p.quote_src_url;
  let anon = req.p.anon;
  let is_seed = req.p.is_seed;
  let mustBeModerator = !!quote_txt || !!twitter_tweet_id || anon;

  console.log("POST_comments begin", Date.now());
  console.log("POST_comments params", req.p);

  // either include txt, or a tweet id
  if (
    (_.isUndefined(txt) || txt === "") &&
    (_.isUndefined(twitter_tweet_id) || twitter_tweet_id === "") &&
    (_.isUndefined(quote_txt) || quote_txt === "")
  ) {
    Log.fail(res, 400, "polis_err_param_missing_txt");
    return;
  }

  if (quote_txt && _.isUndefined(quote_src_url)) {
    Log.fail(res, 400, "polis_err_param_missing_quote_src_url");
    return;
  }

  function doGetPid() {
    console.log("POST_comments doGetPid begin", Date.now());

    // PID_FLOW
    if (_.isUndefined(pid)) {
      return User.getPidPromise(req.p.zid, req.p.uid, true).then(
        (pid: number) => {
          if (pid === -1) {
            console.log(
              "POST_comments doGetPid addParticipant begin",
              Date.now()
            );
            //           Argument of type '(rows: any[]) => number' is not assignable to parameter of type '(value: unknown) => number | PromiseLike<number>'.
            // Types of parameters 'rows' and 'value' are incompatible.
            //             Type 'unknown' is not assignable to type 'any[]'.ts(2345)
            // @ts-ignore
            return addParticipant(req.p.zid, req.p.uid).then(function (
              rows: any[]
            ) {
              let ptpt = rows[0];
              pid = ptpt.pid;
              currentPid = pid;
              console.log(
                "POST_comments doGetPid addParticipant done",
                Date.now()
              );
              return pid;
            });
          } else {
            console.log("POST_comments doGetPid done", Date.now());
            return pid;
          }
        }
      );
    }
    console.log("POST_comments doGetPid done", Date.now());
    return Promise.resolve(pid);
  }
  let twitterPrepPromise = Promise.resolve();
  if (twitter_tweet_id) {
    twitterPrepPromise = prepForTwitterComment(twitter_tweet_id, zid);
  } else if (quote_twitter_screen_name) {
    twitterPrepPromise = prepForQuoteWithTwitterUser(
      quote_twitter_screen_name,
      zid
    );
  }

  console.log("POST_comments before twitterPrepPromise", Date.now());

  twitterPrepPromise
    .then(
      //       No overload matches this call.
      // Overload 1 of 2, '(onFulfill?: ((value: void) => any) | undefined, onReject?: ((error: any) => any) | undefined): Bluebird<any>', gave the following error.
      //   Argument of type '(info: { ptpt: any; tweet: any; }) => Bluebird<any>' is not assignable to parameter of type '(value: void) => any'.
      //     Types of parameters 'info' and 'value' are incompatible.
      //       Type 'void' is not assignable to type '{ ptpt: any; tweet: any; }'.
      // Overload 2 of 2, '(onfulfilled?: ((value: void) => any) | null | undefined, onrejected?: ((reason: any) => Resolvable<void>) | null | undefined): Bluebird<any>', gave the following error.
      //   Argument of type '(info: { ptpt: any; tweet: any; }) => Bluebird<any>' is not assignable to parameter of type '(value: void) => any'.
      //     Types of parameters 'info' and 'value' are incompatible.
      //       Type 'void' is not assignable to type '{ ptpt: any; tweet: any; }'.ts(2769)
      // @ts-ignore
      function (info: { ptpt: any; tweet: any }) {
        console.log("POST_comments after twitterPrepPromise", Date.now());

        let ptpt = info && info.ptpt;
        // let twitterUser = info && info.twitterUser;
        let tweet = info && info.tweet;

        if (tweet) {
          console.log("Post comments tweet", txt, tweet.txt);
          txt = tweet.text;
        } else if (quote_txt) {
          console.log("Post comments quote_txt", txt, quote_txt);
          txt = quote_txt;
        } else {
          console.log("Post comments txt", txt);
        }

        let ip =
          req?.headers?.["x-forwarded-for"] || // TODO This header may contain multiple IP addresses. Which should we report?
          req?.connection?.remoteAddress ||
          req?.socket?.remoteAddress ||
          req?.connection?.socket.remoteAddress;

        let isSpamPromise = isSpam({
          comment_content: txt,
          comment_author: uid,
          permalink: "https://pol.is/" + zid,
          user_ip: ip,
          user_agent: req?.headers?.["user-agent"],
          referrer: req?.headers?.referer,
        });
        isSpamPromise.catch(function (err: any) {
          console.error("isSpam failed");
          console.log("info", err);
        });
        // let isSpamPromise = Promise.resolve(false);
        let isModeratorPromise = isModerator(zid, uid);

        let conversationInfoPromise = Conversation.getConversationInfo(zid);

        // return xidUserPromise.then(function(xidUser) {

        let shouldCreateXidRecord = false;

        let pidPromise;
        if (ptpt) {
          pidPromise = Promise.resolve(ptpt.pid);
        } else {
          let xidUserPromise =
            !_.isUndefined(xid) && !_.isNull(xid)
              ? User.getXidStuff(xid, zid)
              : Promise.resolve();
          pidPromise = xidUserPromise.then((xidUser: UserType) => {
            // @ts-ignore
            shouldCreateXidRecord = xidUser === "noXidRecord";
            if (xidUser && xidUser.uid) {
              uid = xidUser.uid;
              pid = xidUser.pid;
              return pid;
            } else {
              return doGetPid().then((pid: any) => {
                if (shouldCreateXidRecord) {
                  // Expected 6 arguments, but got 3.ts(2554)
                  // conversation.ts(34, 3): An argument for 'x_profile_image_url' was not provided.
                  // @ts-ignore
                  return Conversation.createXidRecordByZid(zid, uid, xid).then(
                    () => {
                      return pid;
                    }
                  );
                }
                return pid;
              });
            }
          });
        }

        let commentExistsPromise = commentExists(zid, txt);

        console.log("POST_comments before Promise.all", Date.now());

        return Promise.all([
          pidPromise,
          conversationInfoPromise,
          isModeratorPromise,
          commentExistsPromise,
        ]).then(
          function (results: any[]) {
            console.log("POST_comments after Promise.all", Date.now());

            let pid = results[0];
            let conv = results[1];
            let is_moderator = results[2];
            let commentExists = results[3];

            if (!is_moderator && mustBeModerator) {
              Log.fail(res, 403, "polis_err_post_comment_auth");
              return;
            }

            if (pid < 0) {
              // NOTE: this API should not be called in /demo mode
              Log.fail(res, 500, "polis_err_post_comment_bad_pid");
              return;
            }

            if (commentExists) {
              Log.fail(res, 409, "polis_err_post_comment_duplicate");
              return;
            }

            if (!conv.is_active) {
              Log.fail(res, 403, "polis_err_conversation_is_closed");
              return;
            }

            if (_.isUndefined(txt)) {
              console.log("undefined txt");
              console.log(req.p);
              throw "polis_err_post_comments_missing_txt";
            }
            let bad = hasBadWords(txt);

            console.log("POST_comments before isSpamPromise", Date.now());
            return isSpamPromise
              .then(
                function (spammy: any) {
                  console.log(
                    "info",
                    "spam test says: " +
                      txt +
                      " " +
                      (spammy ? "spammy" : "not_spammy")
                  );
                  return spammy;
                },
                function (err: any) {
                  console.error("spam check failed");
                  console.log("info", err);
                  return false; // spam check failed, continue assuming "not spammy".
                }
              )
              .then(function (spammy: any) {
                console.log("POST_comments after isSpamPromise", Date.now());
                let velocity = 1;
                let active = true;
                let classifications = [];
                if (bad && conv.profanity_filter) {
                  active = false;
                  classifications.push("bad");
                  console.log(
                    "active=false because (bad && conv.profanity_filter)"
                  );
                }
                if (spammy && conv.spam_filter) {
                  active = false;
                  classifications.push("spammy");
                  console.log(
                    "active=false because (spammy && conv.spam_filter)"
                  );
                }
                if (conv.strict_moderation) {
                  active = false;
                  console.log("active=false because (conv.strict_moderation)");
                }
                if (active) {
                  console.log("active=true");
                }

                let mod = 0; // hasn't yet been moderated.

                // moderators' comments are automatically in (when prepopulating).
                if (is_moderator && is_seed) {
                  mod = Utils.polisTypes.mod.ok;
                  active = true;
                }
                let authorUid = ptpt ? ptpt.uid : uid;

                console.log(
                  "POST_comments before INSERT INTO COMMENTS",
                  Date.now()
                );

                Promise.all([Comment.detectLanguage(txt)]).then((a: any[]) => {
                  let detections = a[0];
                  let detection = Array.isArray(detections)
                    ? detections[0]
                    : detections;
                  let lang = detection.language;
                  let lang_confidence = detection.confidence;

                  return dbPgQuery
                    .queryP(
                      "INSERT INTO COMMENTS " +
                        "(pid, zid, txt, velocity, active, mod, uid, tweet_id, quote_src_url, anon, is_seed, created, tid, lang, lang_confidence) VALUES " +
                        "($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, default, null, $12, $13) RETURNING *;",
                      [
                        pid,
                        zid,
                        txt,
                        velocity,
                        active,
                        mod,
                        authorUid,
                        twitter_tweet_id || null,
                        quote_src_url || null,
                        anon || false,
                        is_seed || false,
                        lang,
                        lang_confidence,
                      ]
                    )
                    .then(
                      //                     Argument of type '(docs: any[]) => any' is not assignable to parameter of type '(value: unknown) => any'.
                      // Types of parameters 'docs' and 'value' are incompatible.
                      //                     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
                      // @ts-ignore
                      function (docs: any[]) {
                        let comment = docs && docs[0];
                        let tid = comment && comment.tid;
                        // let createdTime = comment && comment.created;

                        if (bad || spammy || conv.strict_moderation) {
                          getNumberOfCommentsWithModerationStatus(
                            zid,
                            Utils.polisTypes.mod.unmoderated
                          )
                            .catch(function (err: any) {
                              Log.yell(
                                "polis_err_getting_modstatus_comment_count"
                              );
                              return void 0;
                            })
                            .then(function (n: number) {
                              if (n === 0) {
                                return;
                              }
                              dbPgQuery
                                .queryP_readOnly(
                                  "select * from users where site_id = (select site_id from page_ids where zid = ($1)) UNION select * from users where uid = ($2);",
                                  [zid, conv.owner]
                                )
                                .then(function (users: any) {
                                  let uids = _.pluck(users, "uid");
                                  // also notify polis team for moderation
                                  uids.forEach(function (uid?: any) {
                                    sendCommentModerationEmail(
                                      req,
                                      uid,
                                      zid,
                                      n
                                    );
                                  });
                                });
                            });
                        } else {
                          addNotificationTask(zid);
                        }

                        console.log(
                          "POST_comments before votesPost",
                          Date.now()
                        );

                        // It should be safe to delete this. Was added to postpone the no-auto-vote change for old conversations.
                        if (is_seed && _.isUndefined(vote) && zid <= 17037) {
                          vote = 0;
                        }

                        let createdTime = comment.created;
                        let votePromise = _.isUndefined(vote)
                          ? Promise.resolve()
                          : votesPost(uid, pid, zid, tid, vote, 0, false);

                        return (
                          votePromise
                            // This expression is not callable.
                            //Each member of the union type '{ <U>(onFulfill?: ((value: void) => Resolvable<U>) | undefined, onReject?: ((error: any) => Resolvable<U>) | undefined): Bluebird<U>; <TResult1 = void, TResult2 = never>(onfulfilled?: ((value: void) => Resolvable<...>) | ... 1 more ... | undefined, onrejected?: ((reason: any) => Resolvable<...>) | ... 1 more ... | u...' has signatures, but none of those signatures are compatible with each other.ts(2349)
                            // @ts-ignore
                            .then(
                              function (o: { vote: { created: any } }) {
                                if (o && o.vote && o.vote.created) {
                                  createdTime = o.vote.created;
                                }

                                setTimeout(function () {
                                  updateConversationModifiedTime(
                                    zid,
                                    createdTime
                                  );
                                  updateLastInteractionTimeForConversation(
                                    zid,
                                    uid
                                  );
                                  if (!_.isUndefined(vote)) {
                                    updateVoteCount(zid, pid);
                                  }
                                }, 100);

                                console.log(
                                  "POST_comments sending json",
                                  Date.now()
                                );
                                res.json({
                                  tid: tid,
                                  currentPid: currentPid,
                                });
                                console.log(
                                  "POST_comments sent json",
                                  Date.now()
                                );
                              },
                              function (err: any) {
                                Log.fail(
                                  res,
                                  500,
                                  "polis_err_vote_on_create",
                                  err
                                );
                              }
                            )
                        );
                      },
                      function (err: { code: string | number }) {
                        if (err.code === "23505" || err.code === 23505) {
                          // duplicate comment
                          Log.fail(
                            res,
                            409,
                            "polis_err_post_comment_duplicate",
                            err
                          );
                        } else {
                          Log.fail(res, 500, "polis_err_post_comment", err);
                        }
                      }
                    ); // insert
                }); // lang
              });
          },
          function (errors: any[]) {
            if (errors[0]) {
              Log.fail(res, 500, "polis_err_getting_pid", errors[0]);
              return;
            }
            if (errors[1]) {
              Log.fail(res, 500, "polis_err_getting_conv_info", errors[1]);
              return;
            }
          }
        );
      },
      function (err: any) {
        Log.fail(res, 500, "polis_err_fetching_tweet", err);
      }
    )
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_post_comment_misc", err);
    });
} // end POST /api/v3/comments

function handle_GET_votes_me(
  req: { p: { zid: any; uid?: any; pid: any } },
  res: any
) {
  User.getPid(req.p.zid, req.p.uid, function (err: any, pid: number) {
    if (err || pid < 0) {
      Log.fail(res, 500, "polis_err_getting_pid", err);
      return;
    }
    dbPgQuery.query_readOnly(
      "SELECT * FROM votes WHERE zid = ($1) AND pid = ($2);",
      [req.p.zid, req.p.pid],
      function (err: any, docs: { rows: string | any[] }) {
        if (err) {
          Log.fail(res, 500, "polis_err_get_votes_by_me", err);
          return;
        }
        for (var i = 0; i < docs.rows.length; i++) {
          docs.rows[i].weight = docs.rows[i].weight / 32767;
        }
        finishArray(res, docs.rows);
      }
    );
  });
}

function handle_GET_votes(req: { p: any }, res: any) {
  getVotesForSingleParticipant(req.p).then(
    function (votes: any) {
      finishArray(res, votes);
    },
    function (err: any) {
      Log.fail(res, 500, "polis_err_votes_get", err);
    }
  );
}

function handle_GET_nextComment(
  req: {
    timedout: any;
    p: {
      zid: any;
      not_voted_by_pid: any;
      without: any;
      include_social: any;
      lang: any;
    };
  },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: {}): void; new (): any };
    };
  }
) {
  if (req.timedout) {
    return;
  }
  // NOTE: I tried to speed up this query by adding db indexes, and by removing queries like Conversation.getConversationInfo and finishOne.
  //          They didn't help much, at least under current load, which is negligible. pg:diagnose isn't complaining about indexes.
  //      I think the direction to go as far as optimizing this is to asyncronously build up a synced in-ram list of next comments
  //        for each participant, for currently active conversations. (this would probably be a math-poller-esque process on another
  //         hostclass)
  //         Along with this would be to cache in ram info about moderation status of each comment so we can filter before returning a comment.

  getNextComment(
    req.p.zid,
    req.p.not_voted_by_pid,
    req.p.without,
    req.p.include_social,
    req.p.lang
  )
    .then(
      function (c: { currentPid: any }) {
        if (req.timedout) {
          return;
        }
        if (c) {
          if (!_.isUndefined(req.p.not_voted_by_pid)) {
            c.currentPid = req.p.not_voted_by_pid;
          }
          finishOne(res, c);
        } else {
          let o: CommentOptions = {};
          if (!_.isUndefined(req.p.not_voted_by_pid)) {
            o.currentPid = req.p.not_voted_by_pid;
          }
          res.status(200).json(o);
        }
      },
      function (err: any) {
        if (req.timedout) {
          return;
        }
        Log.fail(res, 500, "polis_err_get_next_comment2", err);
      }
    )
    .catch(function (err: any) {
      if (req.timedout) {
        return;
      }
      Log.fail(res, 500, "polis_err_get_next_comment", err);
    });
}
function handle_GET_participationInit(
  req: {
    p: {
      conversation_id: any;
      uid?: any;
      lang: string;
      zid: any;
      xid: any;
      owner_uid?: any;
      pid: any;
    };
    headers?: Headers;
    cookies: { [x: string]: any };
  },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: {
        (arg0: {
          user: any;
          ptpt: any;
          nextComment: any;
          conversation: any;
          votes: any;
          pca: any;
          famous: any;
          // famous: JSON.parse(arr[6]),
          acceptLanguage: any;
        }): void;
        new (): any;
      };
    };
  }
) {
  function ifConv(
    f: {
      (
        zid: any,
        pid: any,
        withoutTids: any,
        include_social: any,
        lang?: any
      ): CommentType;
      (zid: any, uid?: any, lang?: any): any;
      (p: any): any;
      (zid: any, math_tick: any): any;
      (o: any, req: any): any;
      apply?: any;
    },
    args: any[]
  ) {
    if (req.p.conversation_id) {
      return f.apply(null, args);
    } else {
      return Promise.resolve(null);
    }
  }

  function ifConvAndAuth(f: (zid: any, uid?: any) => any, args: any[]) {
    if (req.p.uid) {
      return ifConv(f, args);
    } else {
      return Promise.resolve(null);
    }
  }

  let acceptLanguage =
    req?.headers?.["accept-language"] ||
    req?.headers?.["Accept-Language"] ||
    "en-US";

  if (req.p.lang === "acceptLang") {
    // "en-US,en;q=0.8,da;q=0.6,it;q=0.4,es;q=0.2,pt-BR;q=0.2,pt;q=0.2" --> "en-US"
    // req.p.lang = acceptLanguage.match("^[^,;]*")[0];
    req.p.lang = acceptLanguage.substr(0, 2);
  }

  cookies.getPermanentCookieAndEnsureItIsSet(req, res);

  Promise.all([
    User.getUser(req.p.uid, req.p.zid, req.p.xid, req.p.owner_uid),
    ifConvAndAuth(getParticipant, [req.p.zid, req.p.uid]),
    //
    // Argument of type '(zid?: any, pid?: any, withoutTids?: any, include_social?: boolean | undefined, lang?: string | undefined) => Bluebird<any>' is not assignable to parameter of type '{ (zid: any, pid: any, withoutTids: any, include_social: any, lang?: any): CommentType; (zid: any, uid?: any, lang?: any): any; (p: any): any; (zid: any, math_tick: any): any; (o: any, req: any): any; apply?: any; }'.
    //  Type 'Bluebird<any>' is missing the following properties from type 'CommentType': zid, not_voted_by_pid, withoutTids, include_voting_patterns, and 9 more.ts(2345)
    // @ts-ignore
    ifConv(getNextComment, [req.p.zid, req.p.pid, [], true, req.p.lang]),
    // getIfConv({uri: "http://" + SELF_HOSTNAME + "/api/v3/conversations", qs: qs, headers: req.headers, gzip: true}),
    //
    // Argument of type '(zid: any, uid?: any, lang?: null | undefined) => Bluebird<any>' is not assignable to parameter of type '{ (zid: any, pid: any, withoutTids: any, include_social: any, lang?: any): CommentType; (zid: any, uid?: any, lang?: any): any; (p: any): any; (zid: any, math_tick: any): any; (o: any, req: any): any; apply?: any; }'.
    // Type 'Bluebird<any>' is not assignable to type 'CommentType'.ts(2345)
    // @ts-ignore
    ifConv(getOneConversation, [req.p.zid, req.p.uid, req.p.lang]),
    // getIfConv({uri: "http://" + SELF_HOSTNAME + "/api/v3/votes", qs: votesByMeQs, headers: req.headers, gzip: true}),
    ifConv(getVotesForSingleParticipant, [req.p]),
    //
    // Argument of type '(zid?: any, math_tick?: number | undefined) => Promise<any>' is not assignable to parameter of type '{ (zid: any, pid: any, withoutTids: any, include_social: any, lang?: any): CommentType; (zid: any, uid?: any, lang?: any): any; (p: any): any; (zid: any, math_tick: any): any; (o: any, req: any): any; apply?: any; }'.
    // Type 'Promise<any>' is missing the following properties from type 'CommentType': zid, not_voted_by_pid, withoutTids, include_voting_patterns, and 9 more.ts(2345)
    // @ts-ignore
    ifConv(getPca, [req.p.zid, -1]),
    // getWith304AsSuccess({uri: "http://" + SELF_HOSTNAME + "/api/v3/math/pca2", qs: qs, headers: req.headers, gzip: true}),
    //
    // Argument of type '(o?: { uid?: any; zid: any; math_tick: any; ptptoiLimit: any; } | undefined, req?: any) => Bluebird<{}>' is not assignable to parameter of type '{ (zid: any, pid: any, withoutTids: any, include_social: any, lang?: any): CommentType; (zid: any, uid?: any, lang?: any): any; (p: any): any; (zid: any, math_tick: any): any; (o: any, req: any): any; apply?: any; }'.
    //   Type 'Bluebird<{}>' is missing the following properties from type 'CommentType': zid, not_voted_by_pid, withoutTids, include_voting_patterns, and 9 more.ts(2345)
    // @ts-ignore
    ifConv(doFamousQuery, [req.p, req]),
    // getIfConv({uri: "http://" + SELF_HOSTNAME + "/api/v3/votes/famous", qs: famousQs, headers: req.headers, gzip: true}),
  ])
    .then(
      function (arr: any[]) {
        let conv = arr[3];
        let o = {
          user: arr[0],
          ptpt: arr[1],
          nextComment: arr[2],
          conversation: conv,
          votes: arr[4] || [],
          pca: arr[5] ? (arr[5].asJSON ? arr[5].asJSON : null) : null,
          famous: arr[6],
          // famous: JSON.parse(arr[6]),
          acceptLanguage: acceptLanguage,
        };
        if (o.conversation) {
          delete o.conversation.zid;
          o.conversation.conversation_id = req.p.conversation_id;
        }
        if (o.ptpt) {
          delete o.ptpt.zid;
        }
        for (var i = 0; i < o.votes.length; i++) {
          delete o.votes[i].zid; // strip zid for security
          // delete o.votes[i].pid; // because it's extra crap. Feel free to delete this line if you need pid.
        }
        if (!o.nextComment) {
          o.nextComment = {};
        }
        if (!_.isUndefined(req.p.pid)) {
          o.nextComment.currentPid = req.p.pid;
        }

        res.status(200).json(o);
      },
      function (err: any) {
        console.error(err);
        Log.fail(res, 500, "polis_err_get_participationInit2", err);
      }
    )
    .catch(function (err: any) {
      console.error(err);
      Log.fail(res, 500, "polis_err_get_participationInit", err);
    });
}

function handle_PUT_participants_extended(
  req: { p: { zid: any; uid?: any; show_translation_activated: any } },
  res: { json: (arg0: any) => void }
) {
  let zid = req.p.zid;
  let uid = req.p.uid;

  let fields: ParticipantFields = {};
  if (!_.isUndefined(req.p.show_translation_activated)) {
    fields.show_translation_activated = req.p.show_translation_activated;
  }

  let q = SQL.sql_participants_extended
    .update(fields)
    .where(SQL.sql_participants_extended.zid.equals(zid))
    .and(SQL.sql_participants_extended.uid.equals(uid));

  dbPgQuery
    .queryP(q.toString(), [])
    .then((result: any) => {
      res.json(result);
    })
    .catch((err: any) => {
      Log.fail(res, 500, "polis_err_put_participants_extended", err);
    });
}

function handle_POST_votes(
  req: {
    p: Vote;
    cookies: { [x: string]: any };
    headers?: Headers;
  },
  res: any
) {
  let uid = req.p.uid; // PID_FLOW uid may be undefined here.
  let zid = req.p.zid;
  let pid = req.p.pid; // PID_FLOW pid may be undefined here.
  let lang = req.p.lang;

  // We allow viewing (and possibly writing) without cookies enabled, but voting requires cookies (except the auto-vote on your own comment, which seems ok)
  let token = req.cookies[cookies.COOKIES.TOKEN];
  let apiToken = req?.headers?.authorization || "";
  let xPolisHeaderToken = req?.headers?.["x-polis"];
  if (!uid && !token && !apiToken && !xPolisHeaderToken) {
    Log.fail(res, 403, "polis_err_vote_noauth");
    return;
  }

  let permanent_cookie = cookies.getPermanentCookieAndEnsureItIsSet(req, res);

  // PID_FLOW WIP for now assume we have a uid, but need a participant record.
  let pidReadyPromise = _.isUndefined(req.p.pid)
    ? addParticipantAndMetadata(
        req.p.zid,
        req.p.uid,
        req,
        permanent_cookie
      ).then(function (rows: any[]) {
        let ptpt = rows[0];
        pid = ptpt.pid;
      })
    : Promise.resolve();
  pidReadyPromise
    .then(function () {
      // let conv;
      let vote;

      // PID_FLOW WIP for now assume we have a uid, but need a participant record.
      let pidReadyPromise = _.isUndefined(pid)
        ? //         Argument of type '(rows: any[]) => void' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.
          // Types of parameters 'rows' and 'value' are incompatible.
          //         Type 'unknown' is not assignable to type 'any[]'.ts(2345)
          // @ts-ignore
          addParticipant(zid, uid).then(function (rows: any[]) {
            let ptpt = rows[0];
            pid = ptpt.pid;
          })
        : Promise.resolve();

      return pidReadyPromise
        .then(function () {
          return votesPost(
            uid,
            pid,
            zid,
            req.p.tid,
            req.p.vote,
            req.p.weight,
            true
          );
        })
        .then(function (o: { vote: any }) {
          // conv = o.conv;
          vote = o.vote;
          let createdTime = vote.created;
          setTimeout(function () {
            updateConversationModifiedTime(zid, createdTime);
            updateLastInteractionTimeForConversation(zid, uid);

            // NOTE: may be greater than number of comments, if they change votes
            updateVoteCount(zid, pid);
          }, 100);
          if (_.isUndefined(req.p.starred)) {
            return;
          } else {
            return addStar(zid, req.p.tid, pid, req.p.starred, createdTime);
          }
        })
        .then(function () {
          return getNextComment(zid, pid, [], true, lang);
        })
        .then(function (nextComment: any) {
          let result: PidReadyResult = {};
          if (nextComment) {
            result.nextComment = nextComment;
          } else {
            // no need to wait for this to finish
            addNoMoreCommentsRecord(zid, pid);
          }
          // PID_FLOW This may be the first time the client gets the pid.
          result.currentPid = pid;
          // result.shouldMod = true; // TODO
          if (result.shouldMod) {
            result.modOptions = {};
            if (req.p.vote === Utils.polisTypes.reactions.pull) {
              result.modOptions.as_important = true;
              result.modOptions.as_factual = true;
              result.modOptions.as_feeling = true;
            } else if (req.p.vote === Utils.polisTypes.reactions.push) {
              result.modOptions.as_notmyfeeling = true;
              result.modOptions.as_notgoodidea = true;
              result.modOptions.as_notfact = true;
              result.modOptions.as_abusive = true;
            } else if (req.p.vote === Utils.polisTypes.reactions.pass) {
              result.modOptions.as_unsure = true;
              result.modOptions.as_spam = true;
              result.modOptions.as_abusive = true;
            }
          }

          finishOne(res, result);
        });
    })
    .catch(function (err: string) {
      if (err === "polis_err_vote_duplicate") {
        Log.fail(res, 406, "polis_err_vote_duplicate", err); // TODO allow for changing votes?
      } else if (err === "polis_err_conversation_is_closed") {
        Log.fail(res, 403, "polis_err_conversation_is_closed", err);
      } else if (err === "polis_err_post_votes_social_needed") {
        Log.fail(res, 403, "polis_err_post_votes_social_needed", err);
      } else {
        Log.fail(res, 500, "polis_err_vote", err);
      }
    });
}

function handle_POST_ptptCommentMod(
  req: {
    p: {
      zid: any;
      pid: any;
      uid?: any;
      tid: any;
      as_abusive: any;
      as_factual: any;
      as_feeling: any;
      as_important: any;
      as_notfact: any;
      as_notgoodidea: any;
      as_notmyfeeling: any;
      as_offtopic: any;
      as_spam: any;
      unsure: any;
      lang: any;
    };
  },
  res: any
) {
  let zid = req.p.zid;
  let pid = req.p.pid;

  let uid = req.p.uid;

  // need('as_important', getBool, assignToP, false),
  // need('as_spam', getBool, assignToP, false),
  // need('as_offtopic', getBool, assignToP, false),

  return dbPgQuery
    .queryP(
      "insert into crowd_mod (" +
        "zid, " +
        "pid, " +
        "tid, " +
        "as_abusive, " +
        "as_factual, " +
        "as_feeling, " +
        "as_important, " +
        "as_notfact, " +
        "as_notgoodidea, " +
        "as_notmyfeeling, " +
        "as_offtopic, " +
        "as_spam, " +
        "as_unsure) values (" +
        "$1, " +
        "$2, " +
        "$3, " +
        "$4, " +
        "$5, " +
        "$6, " +
        "$7, " +
        "$8, " +
        "$9, " +
        "$10, " +
        "$11, " +
        "$12, " +
        "$13);",
      [
        req.p.zid,
        req.p.pid,
        req.p.tid,
        req.p.as_abusive,
        req.p.as_factual,
        req.p.as_feeling,
        req.p.as_important,
        req.p.as_notfact,
        req.p.as_notgoodidea,
        req.p.as_notmyfeeling,
        req.p.as_offtopic,
        req.p.as_spam,
        req.p.unsure,
      ]
    )
    .then((createdTime: any) => {
      setTimeout(function () {
        updateConversationModifiedTime(req.p.zid, createdTime);
        updateLastInteractionTimeForConversation(zid, uid);
      }, 100);
    })
    .then(function () {
      return getNextComment(req.p.zid, pid, [], true, req.p.lang); // TODO req.p.lang is probably not defined
    })
    .then(function (nextComment: any) {
      let result: ParticipantCommentModerationResult = {};
      if (nextComment) {
        result.nextComment = nextComment;
      } else {
        // no need to wait for this to finish
        addNoMoreCommentsRecord(req.p.zid, pid);
      }
      // PID_FLOW This may be the first time the client gets the pid.
      result.currentPid = req.p.pid;
      finishOne(res, result);
    })
    .catch(function (err: string) {
      if (err === "polis_err_ptptCommentMod_duplicate") {
        Log.fail(res, 406, "polis_err_ptptCommentMod_duplicate", err); // TODO allow for changing votes?
      } else if (err === "polis_err_conversation_is_closed") {
        Log.fail(res, 403, "polis_err_conversation_is_closed", err);
      } else {
        Log.fail(res, 500, "polis_err_ptptCommentMod", err);
      }
    });
}

function handle_POST_upvotes(
  req: { p: { uid?: any; zid: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: {}): void; new (): any };
    };
  }
) {
  let uid = req.p.uid;
  let zid = req.p.zid;

  dbPgQuery
    .queryP("select * from upvotes where uid = ($1) and zid = ($2);", [
      uid,
      zid,
    ])
    .then(
      //     Argument of type '(rows: string | any[]) => void' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.
      // Types of parameters 'rows' and 'value' are incompatible.
      //   Type 'unknown' is not assignable to type 'string | any[]'.
      //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
      // @ts-ignore
      function (rows: string | any[]) {
        if (rows && rows.length) {
          Log.fail(res, 403, "polis_err_upvote_already_upvoted");
        } else {
          dbPgQuery
            .queryP("insert into upvotes (uid, zid) VALUES ($1, $2);", [
              uid,
              zid,
            ])
            .then(
              function () {
                dbPgQuery
                  .queryP(
                    "update conversations set upvotes = (select count(*) from upvotes where zid = ($1)) where zid = ($1);",
                    [zid]
                  )
                  .then(
                    function () {
                      res.status(200).json({});
                    },
                    function (err: any) {
                      Log.fail(res, 500, "polis_err_upvote_update", err);
                    }
                  );
              },
              function (err: any) {
                Log.fail(res, 500, "polis_err_upvote_insert", err);
              }
            );
        }
      },
      function (err: any) {
        Log.fail(res, 500, "polis_err_upvote_check", err);
      }
    );
}

function handle_POST_stars(
  req: { p: { zid: any; tid: any; pid: any; starred: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: {}): void; new (): any };
    };
  }
) {
  addStar(req.p.zid, req.p.tid, req.p.pid, req.p.starred)
    //     Argument of type '(result: { rows: { created: any; }[]; }) => void' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.
    // Types of parameters 'result' and 'value' are incompatible.
    //     Type 'unknown' is not assignable to type '{ rows: { created: any; }[]; }'.ts(2345)
    // @ts-ignore
    .then(function (result: { rows: { created: any }[] }) {
      let createdTime = result.rows[0].created;
      setTimeout(function () {
        updateConversationModifiedTime(req.p.zid, createdTime);
      }, 100);
      res.status(200).json({}); // TODO don't stop after the first one, map the inserts to deferreds.
    })
    .catch(function (err: any) {
      if (err) {
        if (isDuplicateKey(err)) {
          Log.fail(res, 406, "polis_err_vote_duplicate", err); // TODO allow for changing votes?
        } else {
          Log.fail(res, 500, "polis_err_vote", err);
        }
      }
    });
}

function handle_POST_trashes(
  req: { p: { pid: any; zid: any; tid: any; trashed: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: {}): void; new (): any };
    };
  }
) {
  let query =
    "INSERT INTO trashes (pid, zid, tid, trashed, created) VALUES ($1, $2, $3, $4, default);";
  let params = [req.p.pid, req.p.zid, req.p.tid, req.p.trashed];
  dbPgQuery.query(
    query,
    params,
    function (err: any, result: { rows: { created: any }[] }) {
      if (err) {
        if (isDuplicateKey(err)) {
          Log.fail(res, 406, "polis_err_vote_duplicate", err); // TODO allow for changing votes?
        } else {
          Log.fail(res, 500, "polis_err_vote", err);
        }
        return;
      }

      let createdTime = result.rows[0].created;
      setTimeout(function () {
        updateConversationModifiedTime(req.p.zid, createdTime);
      }, 100);

      res.status(200).json({}); // TODO don't stop after the first one, map the inserts to deferreds.
    }
  );
}

function handle_PUT_comments(
  req: {
    p: { uid?: any; zid: any; tid: any; active: any; mod: any; is_meta: any };
  },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: {}): void; new (): any };
    };
  }
) {
  let uid = req.p.uid;
  let zid = req.p.zid;
  let tid = req.p.tid;
  let active = req.p.active;
  let mod = req.p.mod;
  let is_meta = req.p.is_meta;

  isModerator(zid, uid)
    .then(function (isModerator: any) {
      if (isModerator) {
        moderateComment(zid, tid, active, mod, is_meta).then(
          function () {
            res.status(200).json({});
          },
          function (err: any) {
            Log.fail(res, 500, "polis_err_update_comment", err);
          }
        );
      } else {
        Log.fail(res, 403, "polis_err_update_comment_auth");
      }
    })
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_update_comment", err);
    });
}

function handle_POST_reportCommentSelections(
  req: { p: { uid?: any; zid: any; rid: any; tid: any; include: any } },
  res: { json: (arg0: {}) => void }
) {
  let uid = req.p.uid;
  let zid = req.p.zid;
  let rid = req.p.rid;
  let tid = req.p.tid;
  let selection = req.p.include ? 1 : -1;
  isModerator(zid, uid)
    .then((isMod: any) => {
      if (!isMod) {
        return Log.fail(
          res,
          403,
          "polis_err_POST_reportCommentSelections_auth"
        );
      }
      return dbPgQuery
        .queryP(
          "insert into report_comment_selections (rid, tid, selection, zid, modified) values ($1, $2, $3, $4, now_as_millis()) " +
            "on conflict (rid, tid) do update set selection = ($3), zid  = ($4), modified = now_as_millis();",
          [rid, tid, selection, zid]
        )
        .then(() => {
          // The old report isn't valid anymore, so when a user loads the report again a new worker_tasks entry will be created.
          return dbPgQuery.queryP(
            "delete from math_report_correlationmatrix where rid = ($1);",
            [rid]
          );
        })
        .then(() => {
          res.json({});
        });
    })
    .catch((err: any) => {
      Log.fail(res, 500, "polis_err_POST_reportCommentSelections_misc", err);
    });
}

function handle_GET_lti_oauthv1_credentials(
  req: { p: { uid: string } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: string): void; new (): any };
    };
  }
) {
  let uid = "FOO";
  if (req.p && req.p.uid) {
    uid = req.p.uid;
  }
  Promise.all([
    Password.generateTokenP(40, false),
    Password.generateTokenP(40, false),
  ]).then(
    // No overload matches this call.
    // Overload 1 of 2, '(onFulfill?: ((value: [unknown, unknown]) => Resolvable<void>) | undefined, onReject?: ((error: any) => Resolvable<void>) | undefined):
    //     Bluebird<void>', gave the following error.
    //   Argument of type '(results: string[]) => void' is not assignable to parameter of type '(value: [unknown, unknown]) => Resolvable<void>'.
    //     Types of parameters 'results' and 'value' are incompatible.
    //       Type '[unknown, unknown]' is not assignable to type 'string[]'.
    //         Type 'unknown' is not assignable to type 'string'.
    // Overload 2 of 2, '(onfulfilled?: ((value: [unknown, unknown]) => Resolvable<void>) | null | undefined, onrejected?: ((reason: any) => PromiseLike<never>) | null | undefined): Bluebird<void>', gave the following error.
    //   Argument of type '(results: string[]) => void' is not assignable to parameter of type '(value: [unknown, unknown]) => Resolvable<void>'.
    //     Types of parameters 'results' and 'value' are incompatible.
    //     Type '[unknown, unknown]' is not assignable to type 'string[]'.ts(2769)
    // @ts-ignore
    function (results: string[]) {
      let key = "polis_oauth_consumer_key_" + results[0];
      let secret = "polis_oauth_shared_secret_" + results[1];
      let x = [uid, "'" + key + "'", "'" + secret + "'"].join(",");
      // return the query, they we can manually run this in the pg shell, and email? the keys to the instructor
      res
        .status(200)
        .json(
          "INSERT INTO lti_oauthv1_credentials (uid, oauth_consumer_key, oauth_shared_secret) values (" +
            x +
            ") returning oauth_consumer_key, oauth_shared_secret;"
        );
    }
  );
}
function handle_POST_conversation_close(
  req: { p: { zid: any; uid?: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: {}): void; new (): any };
    };
  }
) {
  var q = "select * from conversations where zid = ($1)";
  var params = [req.p.zid];
  if (!isPolisDev(req.p.uid)) {
    q = q + " and owner = ($2)";
    params.push(req.p.uid);
  }
  dbPgQuery
    .queryP(q, params)
    //     Argument of type '(rows: string | any[]) => void' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.
    // Types of parameters 'rows' and 'value' are incompatible.
    //   Type 'unknown' is not assignable to type 'string | any[]'.
    //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
    // @ts-ignore
    .then(function (rows: string | any[]) {
      if (!rows || !rows.length) {
        Log.fail(
          res,
          500,
          "polis_err_closing_conversation_no_such_conversation"
        );
        return;
      }
      let conv = rows[0];
      // if (conv.is_active) {
      // regardless of old state, go ahead and close it, and update grades. will make testing easier.
      dbPgQuery
        .queryP(
          "update conversations set is_active = false where zid = ($1);",
          [conv.zid]
        )
        .then(function () {
          if (conv.is_slack) {
            Session.sendSlackEvent({
              type: "closed",
              data: conv,
            });
          }

          // might need to send some grades
          let ownerUid = req.p.uid;
          sendCanvasGradesIfNeeded(conv.zid, ownerUid)
            .then(function (listOfContexts: any) {
              return updateLocalRecordsToReflectPostedGrades(listOfContexts);
            })
            .then(function () {
              res.status(200).json({});
            })
            .catch(function (err: any) {
              Log.fail(
                res,
                500,
                "polis_err_closing_conversation_sending_grades",
                err
              );
            });
        })
        .catch(function (err: any) {
          Log.fail(res, 500, "polis_err_closing_conversation2", err);
        });
    })
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_closing_conversation", err);
    });
}

function handle_POST_conversation_reopen(
  req: { p: { zid: any; uid?: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: {}): void; new (): any };
    };
  }
) {
  var q = "select * from conversations where zid = ($1)";
  var params = [req.p.zid];
  if (!isPolisDev(req.p.uid)) {
    q = q + " and owner = ($2)";
    params.push(req.p.uid);
  }
  dbPgQuery
    .queryP(q, params)
    //     Argument of type '(rows: string | any[]) => void' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.
    // Types of parameters 'rows' and 'value' are incompatible.
    //   Type 'unknown' is not assignable to type 'string | any[]'.
    //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
    // @ts-ignore
    .then(function (rows: string | any[]) {
      if (!rows || !rows.length) {
        Log.fail(
          res,
          500,
          "polis_err_closing_conversation_no_such_conversation"
        );
        return;
      }
      let conv = rows[0];
      dbPgQuery
        .queryP("update conversations set is_active = true where zid = ($1);", [
          conv.zid,
        ])
        .then(function () {
          if (conv.is_slack) {
            Session.sendSlackEvent({
              type: "reopened",
              data: conv,
            });
          }
          res.status(200).json({});
        })
        .catch(function (err: any) {
          Log.fail(res, 500, "polis_err_reopening_conversation2", err);
        });
    })
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_reopening_conversation", err);
    });
}

function handle_PUT_users(
  req: { p: { uid?: any; uid_of_user: any; email: any; hname: any } },
  res: { json: (arg0: any) => void }
) {
  let uid = req.p.uid;
  if (isPolisDev(uid) && req.p.uid_of_user) {
    uid = req.p.uid_of_user;
  }

  let fields: UserType = {};
  if (!_.isUndefined(req.p.email)) {
    fields.email = req.p.email;
  }
  if (!_.isUndefined(req.p.hname)) {
    fields.hname = req.p.hname;
  }

  let q = SQL.sql_users.update(fields).where(SQL.sql_users.uid.equals(uid));

  dbPgQuery
    .queryP(q.toString(), [])
    .then((result: any) => {
      res.json(result);
    })
    .catch((err: any) => {
      Log.fail(res, 500, "polis_err_put_user", err);
    });
}

function handle_PUT_conversations(
  req: {
    p: {
      short_url: any;
      zid: any;
      uid?: any;
      verifyMeta: any;
      is_active: any;
      is_anon: any;
      is_draft: any;
      is_data_open: any;
      profanity_filter: any;
      spam_filter: any;
      strict_moderation: any;
      topic: string;
      description: string;
      vis_type: any;
      help_type: any;
      socialbtn_type: any;
      bgcolor: string;
      help_color: string;
      help_bgcolor: string;
      style_btn: any;
      write_type: any;
      owner_sees_participation_stats: any;
      launch_presentation_return_url_hex: any;
      link_url: any;
      send_created_email: any;
      conversation_id: string;
      custom_canvas_assignment_id: any;
      tool_consumer_instance_guid?: any;
      context: any;
    };
  },
  res: any
) {
  let generateShortUrl = req.p.short_url;
  isModerator(req.p.zid, req.p.uid)
    .then(function (ok: any) {
      if (!ok) {
        Log.fail(res, 403, "polis_err_update_conversation_permission");
        return;
      }

      let verifyMetaPromise;
      if (req.p.verifyMeta) {
        verifyMetaPromise = verifyMetadataAnswersExistForEachQuestion(
          req.p.zid
        );
      } else {
        verifyMetaPromise = Promise.resolve();
      }

      let fields: ConversationType = {};
      if (!_.isUndefined(req.p.is_active)) {
        fields.is_active = req.p.is_active;
      }
      if (!_.isUndefined(req.p.is_anon)) {
        fields.is_anon = req.p.is_anon;
      }
      if (!_.isUndefined(req.p.is_draft)) {
        fields.is_draft = req.p.is_draft;
      }
      if (!_.isUndefined(req.p.is_data_open)) {
        fields.is_data_open = req.p.is_data_open;
      }
      if (!_.isUndefined(req.p.profanity_filter)) {
        fields.profanity_filter = req.p.profanity_filter;
      }
      if (!_.isUndefined(req.p.spam_filter)) {
        fields.spam_filter = req.p.spam_filter;
      }
      if (!_.isUndefined(req.p.strict_moderation)) {
        fields.strict_moderation = req.p.strict_moderation;
      }
      if (!_.isUndefined(req.p.topic)) {
        fields.topic = req.p.topic;
      }
      if (!_.isUndefined(req.p.description)) {
        fields.description = req.p.description;
      }
      if (!_.isUndefined(req.p.vis_type)) {
        fields.vis_type = req.p.vis_type;
      }
      if (!_.isUndefined(req.p.help_type)) {
        fields.help_type = req.p.help_type;
      }
      if (!_.isUndefined(req.p.socialbtn_type)) {
        fields.socialbtn_type = req.p.socialbtn_type;
      }
      if (!_.isUndefined(req.p.bgcolor)) {
        if (req.p.bgcolor === "default") {
          fields.bgcolor = null;
        } else {
          fields.bgcolor = req.p.bgcolor;
        }
      }
      if (!_.isUndefined(req.p.help_color)) {
        if (req.p.help_color === "default") {
          fields.help_color = null;
        } else {
          fields.help_color = req.p.help_color;
        }
      }
      if (!_.isUndefined(req.p.help_bgcolor)) {
        if (req.p.help_bgcolor === "default") {
          fields.help_bgcolor = null;
        } else {
          fields.help_bgcolor = req.p.help_bgcolor;
        }
      }
      if (!_.isUndefined(req.p.style_btn)) {
        fields.style_btn = req.p.style_btn;
      }
      if (!_.isUndefined(req.p.write_type)) {
        fields.write_type = req.p.write_type;
      }
      ifDefinedSet("auth_needed_to_vote", req.p, fields);
      ifDefinedSet("auth_needed_to_write", req.p, fields);
      ifDefinedSet("auth_opt_fb", req.p, fields);
      ifDefinedSet("auth_opt_tw", req.p, fields);
      ifDefinedSet("auth_opt_allow_3rdparty", req.p, fields);

      if (!_.isUndefined(req.p.owner_sees_participation_stats)) {
        fields.owner_sees_participation_stats =
          !!req.p.owner_sees_participation_stats;
      }
      if (!_.isUndefined(req.p.launch_presentation_return_url_hex)) {
        fields.lti_users_only = true;
      }
      if (!_.isUndefined(req.p.link_url)) {
        fields.link_url = req.p.link_url;
      }

      ifDefinedSet("subscribe_type", req.p, fields);

      let q = SQL.sql_conversations
        .update(fields)
        .where(SQL.sql_conversations.zid.equals(req.p.zid))
        // .and( SQL.sql_conversations.owner.equals(req.p.uid) )
        .returning("*");
      verifyMetaPromise.then(
        function () {
          dbPgQuery.query(
            q.toString(),
            function (err: any, result: { rows: any[] }) {
              if (err) {
                Log.fail(res, 500, "polis_err_update_conversation", err);
                return;
              }
              let conv = result && result.rows && result.rows[0];
              // The first check with isModerator implictly tells us this can be returned in HTTP response.
              conv.is_mod = true;

              let promise = generateShortUrl
                ? generateAndReplaceZinvite(req.p.zid, generateShortUrl)
                : Promise.resolve();
              let successCode = generateShortUrl ? 201 : 200;

              promise
                .then(function () {
                  // send notification email
                  if (req.p.send_created_email) {
                    Promise.all([
                      User.getUserInfoForUid2(req.p.uid),
                      getConversationUrl(req, req.p.zid, true),
                    ])
                      .then(function (results: any[]) {
                        let hname = results[0].hname;
                        let url = results[1];
                        sendEmailByUid(
                          req.p.uid,
                          "Conversation created",
                          "Hi " +
                            hname +
                            ",\n" +
                            "\n" +
                            "Here's a link to the conversation you just created. Use it to invite participants to the conversation. Share it by whatever network you prefer - Gmail, Facebook, Twitter, etc., or just post it to your website or blog. Try it now! Click this link to go to your conversation:" +
                            "\n" +
                            url +
                            "\n" +
                            "\n" +
                            "With gratitude,\n" +
                            "\n" +
                            "The team at pol.is\n"
                        ).catch(function (err: any) {
                          console.error(err);
                        });
                      })
                      .catch(function (err: any) {
                        Log.yell(
                          "polis_err_sending_conversation_created_email"
                        );
                        console.log("info", err);
                      });
                  }

                  if (req.p.launch_presentation_return_url_hex) {
                    // using links because iframes are pretty crappy within Canvas assignments.
                    let linkText = "pol.is conversation";
                    if (req.p.topic) {
                      linkText += " (" + req.p.topic + ")";
                    }
                    let linkTitle = "";
                    if (req.p.description) {
                      linkTitle += req.p.description;
                    }
                    conv.lti_redirect = {
                      return_type: "url",
                      launch_presentation_return_url: Utils.hexToStr(
                        req.p.launch_presentation_return_url_hex
                      ),
                      url:
                        Config.getServerNameWithProtocol(req) +
                        "/" +
                        req.p.conversation_id,
                      text: linkText,
                      title: linkTitle,
                      target: "_blank", // Open in a new window.
                    };
                  }

                  if (req.p.custom_canvas_assignment_id) {
                    addCanvasAssignmentConversationInfoIfNeeded(
                      req.p.zid,
                      req.p.tool_consumer_instance_guid,
                      req.p.context, // lti_context_id,
                      req.p.custom_canvas_assignment_id
                    )
                      .then(function () {
                        finishOne(res, conv, true, successCode);
                      })
                      .catch(function (err: any) {
                        Log.fail(
                          res,
                          500,
                          "polis_err_saving_assignment_grading_context",
                          err
                        );
                        emailBadProblemTime(
                          "PUT conversation worked, but couldn't save assignment context"
                        );
                      });
                  } else {
                    finishOne(res, conv, true, successCode);
                  }

                  updateConversationModifiedTime(req.p.zid);
                })
                .catch(function (err: any) {
                  Log.fail(res, 500, "polis_err_update_conversation", err);
                });
            }
          );
        },
        function (err: { message: any }) {
          Log.fail(res, 500, err.message, err);
        }
      );
    })
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_update_conversation", err);
    });
}

function handle_DELETE_metadata_questions(
  req: { p: { uid?: any; pmqid: any } },
  res: { send: (arg0: number) => void }
) {
  let uid = req.p.uid;
  let pmqid = req.p.pmqid;

  getZidForQuestion(pmqid, function (err: any, zid: any) {
    if (err) {
      Log.fail(
        res,
        500,
        "polis_err_delete_participant_metadata_questions_zid",
        err
      );
      return;
    }
    isConversationOwner(zid, uid, function (err: any) {
      if (err) {
        Log.fail(
          res,
          403,
          "polis_err_delete_participant_metadata_questions_auth",
          err
        );
        return;
      }

      deleteMetadataQuestionAndAnswers(pmqid, function (err?: string | null) {
        if (err) {
          Log.fail(
            res,
            500,
            "polis_err_delete_participant_metadata_question",
            new Error(err)
          );
          return;
        }
        res.send(200);
      });
    });
  });
}

function handle_DELETE_metadata_answers(
  req: { p: { uid?: any; pmaid: any } },
  res: { send: (arg0: number) => void }
) {
  let uid = req.p.uid;
  let pmaid = req.p.pmaid;

  getZidForAnswer(pmaid, function (err: any, zid: any) {
    if (err) {
      Log.fail(
        res,
        500,
        "polis_err_delete_participant_metadata_answers_zid",
        err
      );
      return;
    }
    isConversationOwner(zid, uid, function (err: any) {
      if (err) {
        Log.fail(
          res,
          403,
          "polis_err_delete_participant_metadata_answers_auth",
          err
        );
        return;
      }

      deleteMetadataAnswer(pmaid, function (err: any) {
        if (err) {
          Log.fail(
            res,
            500,
            "polis_err_delete_participant_metadata_answers",
            err
          );
          return;
        }
        res.send(200);
      });
    });
  });
}

function handle_GET_metadata_questions(
  req: { p: { zid: any; zinvite: any; suzinvite: any } },
  res: any
) {
  let zid = req.p.zid;
  let zinvite = req.p.zinvite;
  let suzinvite = req.p.suzinvite;

  function doneChecking(err: boolean, foo?: undefined) {
    if (err) {
      Log.fail(res, 403, "polis_err_get_participant_metadata_auth", err);
      return;
    }

    //     No overload matches this call.
    // Overload 1 of 3, '(tasks: AsyncFunction<{ rows: any; }, any>[], callback?: AsyncResultArrayCallback<{ rows: any; }, any> | undefined): void', gave the following error.
    //   Argument of type '(err: any, result: { rows: any; }[]) => void' is not assignable to parameter of type 'AsyncResultArrayCallback<{ rows: any; }, any>'.
    //     Types of parameters 'result' and 'results' are incompatible.
    //       Type '({ rows: any; } | undefined)[] | undefined' is not assignable to type '{ rows: any; }[]'.
    //         Type 'undefined' is not assignable to type '{ rows: any; }[]'.
    // Overload 2 of 3, '(tasks: Dictionary<AsyncFunction<unknown, any>>, callback?: AsyncResultObjectCallback<unknown, any> | undefined): void', gave the following error.
    //   Argument of type '((callback: any) => void)[]' is not assignable to parameter of type 'Dictionary<AsyncFunction<unknown, any>>'.
    //     Index signature is missing in type '((callback: any) => void)[]'.ts(2769)
    // @ts-ignore
    async.parallel(
      [
        function (callback: any) {
          dbPgQuery.query_readOnly(
            "SELECT * FROM participant_metadata_questions WHERE alive = true AND zid = ($1);",
            [zid],
            callback
          );
        },
        //function(callback) { dbPgQuery.query_readOnly("SELECT * FROM participant_metadata_answers WHERE alive = true AND zid = ($1);", [zid], callback); },
        //function(callback) { dbPgQuery.query_readOnly("SELECT * FROM participant_metadata_choices WHERE alive = true AND zid = ($1);", [zid], callback); },
      ],
      function (err: any, result: { rows: any }[]) {
        if (err) {
          Log.fail(
            res,
            500,
            "polis_err_get_participant_metadata_questions",
            err
          );
          return;
        }
        let rows = result[0] && result[0].rows;
        rows = rows.map(function (r: { required: boolean }) {
          r.required = true;
          return r;
        });
        finishArray(res, rows);
      }
    );
  }

  if (zinvite) {
    //       (local function) doneChecking(err: boolean, foo?: undefined): void
    // Argument of type '(err: boolean, foo?: undefined) => void' is not assignable to parameter of type '{ (err: any, foo: any): void; (err: any, foo: any): void; (err: any): void; (arg0: number | null): void; }'.
    //   Types of parameters 'err' and 'arg0' are incompatible.
    //     Type 'number | null' is not assignable to type 'boolean'.
    //         Type 'null' is not assignable to type 'boolean'.ts(2345)
    // @ts-ignore
    checkZinviteCodeValidity(zid, zinvite, doneChecking);
  } else if (suzinvite) {
    //       (local function) checkSuzinviteCodeValidity(zid: any, suzinvite: any, callback: {
    //     (err: any, foo: any): void;
    //     (err: any, foo: any): void;
    //     (err: any): void;
    //     (arg0: number | null): void;
    // }): void
    // Argument of type '(err: boolean, foo?: undefined) => void' is not assignable to parameter of type '{ (err: any, foo: any): void; (err: any, foo: any): void; (err: any): void; (arg0: number | null): void; }'.
    //   Types of parameters 'err' and 'arg0' are incompatible.
    //       Type 'number | null' is not assignable to type 'boolean'.ts(2345)
    // @ts-ignore
    checkSuzinviteCodeValidity(zid, suzinvite, doneChecking);
  } else {
    doneChecking(false);
  }
}

function handle_POST_metadata_questions(
  req: { p: { zid: any; key: any; uid?: any } },
  res: any
) {
  let zid = req.p.zid;
  let key = req.p.key;
  let uid = req.p.uid;

  function doneChecking(err: any, foo?: any) {
    if (err) {
      Log.fail(res, 403, "polis_err_post_participant_metadata_auth", err);
      return;
    }
    dbPgQuery.query(
      "INSERT INTO participant_metadata_questions (pmqid, zid, key) VALUES (default, $1, $2) RETURNING *;",
      [zid, key],
      function (err: any, results: { rows: string | any[] }) {
        if (err || !results || !results.rows || !results.rows.length) {
          Log.fail(res, 500, "polis_err_post_participant_metadata_key", err);
          return;
        }

        finishOne(res, results.rows[0]);
      }
    );
  }

  isConversationOwner(zid, uid, doneChecking);
}

function handle_POST_metadata_answers(
  req: { p: { zid: any; uid?: any; pmqid: any; value: any } },
  res: any
) {
  let zid = req.p.zid;
  let uid = req.p.uid;
  let pmqid = req.p.pmqid;
  let value = req.p.value;

  function doneChecking(err: any, foo?: any) {
    if (err) {
      Log.fail(res, 403, "polis_err_post_participant_metadata_auth", err);
      return;
    }
    dbPgQuery.query(
      "INSERT INTO participant_metadata_answers (pmqid, zid, value, pmaid) VALUES ($1, $2, $3, default) RETURNING *;",
      [pmqid, zid, value],
      function (err: any, results: { rows: string | any[] }) {
        if (err || !results || !results.rows || !results.rows.length) {
          dbPgQuery.query(
            "UPDATE participant_metadata_answers set alive = TRUE where pmqid = ($1) AND zid = ($2) AND value = ($3) RETURNING *;",
            [pmqid, zid, value],
            function (err: any, results: { rows: any[] }) {
              if (err) {
                Log.fail(
                  res,
                  500,
                  "polis_err_post_participant_metadata_value",
                  err
                );
                return;
              }
              finishOne(res, results.rows[0]);
            }
          );
        } else {
          finishOne(res, results.rows[0]);
        }
      }
    );
  }

  isConversationOwner(zid, uid, doneChecking);
}

function handle_GET_metadata_choices(req: { p: { zid: any } }, res: any) {
  let zid = req.p.zid;

  getChoicesForConversation(zid).then(
    function (choices: any) {
      finishArray(res, choices);
    },
    function (err: any) {
      Log.fail(res, 500, "polis_err_get_participant_metadata_choices", err);
    }
  );
}
function handle_GET_metadata_answers(
  req: { p: { zid: any; zinvite: any; suzinvite: any; pmqid: any } },
  res: any
) {
  let zid = req.p.zid;
  let zinvite = req.p.zinvite;
  let suzinvite = req.p.suzinvite;
  let pmqid = req.p.pmqid;

  function doneChecking(err: boolean, foo?: undefined) {
    if (err) {
      Log.fail(res, 403, "polis_err_get_participant_metadata_auth", err);
      return;
    }
    let query = SQL.sql_participant_metadata_answers
      .select(SQL.sql_participant_metadata_answers.star())
      .where(SQL.sql_participant_metadata_answers.zid.equals(zid))
      .and(SQL.sql_participant_metadata_answers.alive.equals(true));

    if (pmqid) {
      query = query.where(
        SQL.sql_participant_metadata_answers.pmqid.equals(pmqid)
      );
    }
    dbPgQuery.query_readOnly(
      query.toString(),
      function (err: any, result: { rows: any[] }) {
        if (err) {
          Log.fail(res, 500, "polis_err_get_participant_metadata_answers", err);
          return;
        }
        let rows = result.rows.map(function (r: { is_exclusive: boolean }) {
          r.is_exclusive = true; // TODO fetch this info from the queston itself
          return r;
        });
        finishArray(res, rows);
      }
    );
  }

  if (zinvite) {
    //       (local function) doneChecking(err: boolean, foo?: undefined): void
    // Argument of type '(err: boolean, foo?: undefined) => void' is not assignable to parameter of type '{ (err: any, foo: any): void; (err: any, foo: any): void; (err: any): void; (arg0: number | null): void; }'.
    //   Types of parameters 'err' and 'arg0' are incompatible.
    //         Type 'number | null' is not assignable to type 'boolean'.ts(2345)
    // @ts-ignore
    checkZinviteCodeValidity(zid, zinvite, doneChecking);
  } else if (suzinvite) {
    //       (local function) doneChecking(err: boolean, foo?: undefined): void
    // Argument of type '(err: boolean, foo?: undefined) => void' is not assignable to parameter of type '{ (err: any, foo: any): void; (err: any, foo: any): void; (err: any): void; (arg0: number | null): void; }'.
    //   Types of parameters 'err' and 'arg0' are incompatible.
    //     Type 'number | null' is not assignable to type 'boolean'.ts(2345)
    // @ts-ignore
    checkSuzinviteCodeValidity(zid, suzinvite, doneChecking);
  } else {
    doneChecking(false);
  }
}
function handle_GET_metadata(
  req: { p: { zid: any; zinvite: any; suzinvite: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: {
        (arg0: { kvp?: {}; keys?: {}; values?: {} }): void;
        new (): any;
      };
    };
  }
) {
  let zid = req.p.zid;
  let zinvite = req.p.zinvite;
  let suzinvite = req.p.suzinvite;

  function doneChecking(err: boolean) {
    if (err) {
      Log.fail(res, 403, "polis_err_get_participant_metadata_auth", err);
      return;
    }

    //     No overload matches this call.
    // Overload 1 of 3, '(tasks: AsyncFunction<{ rows: any; }, any>[], callback?: AsyncResultArrayCallback<{ rows: any; }, any> | undefined): void', gave the following error.
    //   Argument of type '(err: any, result: { rows: any; }[]) => void' is not assignable to parameter of type 'AsyncResultArrayCallback<{ rows: any; }, any>'.
    //     Types of parameters 'result' and 'results' are incompatible.
    //       Type '({ rows: any; } | undefined)[] | undefined' is not assignable to type '{ rows: any; }[]'.
    //         Type 'undefined' is not assignable to type '{ rows: any; }[]'.
    // Overload 2 of 3, '(tasks: Dictionary<AsyncFunction<unknown, any>>, callback?: AsyncResultObjectCallback<unknown, any> | undefined): void', gave the following error.
    //   Argument of type '((callback: any) => void)[]' is not assignable to parameter of type 'Dictionary<AsyncFunction<unknown, any>>'.
    //     Index signature is missing in type '((callback: any) => void)[]'.ts(2769)
    // @ts-ignore
    async.parallel(
      [
        function (callback: any) {
          dbPgQuery.query_readOnly(
            "SELECT * FROM participant_metadata_questions WHERE zid = ($1);",
            [zid],
            callback
          );
        },
        function (callback: any) {
          dbPgQuery.query_readOnly(
            "SELECT * FROM participant_metadata_answers WHERE zid = ($1);",
            [zid],
            callback
          );
        },
        function (callback: any) {
          dbPgQuery.query_readOnly(
            "SELECT * FROM participant_metadata_choices WHERE zid = ($1);",
            [zid],
            callback
          );
        },
      ],
      function (err: any, result: { rows: any }[]) {
        if (err) {
          Log.fail(res, 500, "polis_err_get_participant_metadata", err);
          return;
        }
        let keys = result[0] && result[0].rows;
        let vals = result[1] && result[1].rows;
        let choices = result[2] && result[2].rows;
        let o = {};
        let keyNames = {};
        let valueNames = {};
        let i;
        let k;
        let v;
        if (!keys || !keys.length) {
          res.status(200).json({});
          return;
        }
        for (i = 0; i < keys.length; i++) {
          // Add a map for each keyId
          k = keys[i];
          // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
          // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
          // @ts-ignore
          o[k.pmqid] = {};
          // keep the user-facing key name
          // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
          // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
          // @ts-ignore
          keyNames[k.pmqid] = k.key;
        }
        for (i = 0; i < vals.length; i++) {
          // Add an array for each possible valueId
          k = vals[i];
          v = vals[i];
          // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
          // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
          // @ts-ignore
          o[k.pmqid][v.pmaid] = [];
          // keep the user-facing value string
          // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
          // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
          // @ts-ignore
          valueNames[v.pmaid] = v.value;
        }
        for (i = 0; i < choices.length; i++) {
          // Append a pid for each person who has seleted that value for that key.
          // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
          // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
          // @ts-ignore
          o[choices[i].pmqid][choices[i].pmaid] = choices[i].pid;
        }
        // TODO cache
        res.status(200).json({
          kvp: o, // key_id => value_id => [pid]
          keys: keyNames,
          values: valueNames,
        });
      }
    );
  }

  if (zinvite) {
    //       (local function) doneChecking(err: boolean): void
    // Argument of type '(err: boolean) => void' is not assignable to parameter of type '{ (err: any, foo: any): void; (err: any, foo: any): void; (err: any): void; (arg0: number | null): void; }'.
    //   Types of parameters 'err' and 'arg0' are incompatible.
    //         Type 'number | null' is not assignable to type 'boolean'.ts(2345)
    // @ts-ignore
    checkZinviteCodeValidity(zid, zinvite, doneChecking);
  } else if (suzinvite) {
    //       (local function) doneChecking(err: boolean): void
    // Argument of type '(err: boolean) => void' is not assignable to parameter of type '{ (err: any, foo: any): void; (err: any, foo: any): void; (err: any): void; (arg0: number | null): void; }'.
    //   Types of parameters 'err' and 'arg0' are incompatible.
    //         Type 'number | null' is not assignable to type 'boolean'.ts(2345)
    // @ts-ignore
    checkSuzinviteCodeValidity(zid, suzinvite, doneChecking);
  } else {
    doneChecking(false);
  }
}

function handle_POST_reports(
  req: { p: { zid: any; uid?: any } },
  res: { json: (arg0: {}) => void }
) {
  let zid = req.p.zid;
  let uid = req.p.uid;

  return (
    isModerator(zid, uid)
      // Argument of type '(isMod: any, err: string) => void | globalThis.Promise<void>' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.ts(2345)
      // @ts-ignore
      .then((isMod: any, err: string) => {
        if (!isMod) {
          return Log.fail(res, 403, "polis_err_post_reports_permissions", err);
        }
        return createReport(zid).then(() => {
          res.json({});
        });
      })
      .catch((err: any) => {
        Log.fail(res, 500, "polis_err_post_reports_misc", err);
      })
  );
}
function handle_PUT_reports(
  req: {
    p: { [x: string]: any; rid: any; uid?: any; zid: any; report_name: any };
  },
  res: { json: (arg0: {}) => void }
) {
  let rid = req.p.rid;
  let uid = req.p.uid;
  let zid = req.p.zid;

  return (
    isModerator(zid, uid)
      // Argument of type '(isMod: any, err: string) => void | globalThis.Promise<void>' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.ts(2345)
      // @ts-ignore
      .then((isMod: any, err: string) => {
        if (!isMod) {
          return Log.fail(res, 403, "polis_err_put_reports_permissions", err);
        }

        let fields: { [key: string]: string } = {
          modified: "now_as_millis()",
        };

        SQL.sql_reports.columns
          .map((c: { name: any }) => {
            return c.name;
          })
          .filter((name: string) => {
            // only allow changing label fields, (label_x_neg, etc) not zid, etc.
            return name.startsWith("label_");
          })
          .forEach((name: string | number) => {
            if (!_.isUndefined(req.p[name])) {
              fields[name] = req.p[name];
            }
          });

        if (!_.isUndefined(req.p.report_name)) {
          fields.report_name = req.p.report_name;
        }

        let q = SQL.sql_reports
          .update(fields)
          .where(SQL.sql_reports.rid.equals(rid));

        let query = q.toString();
        query = query.replace("'now_as_millis()'", "now_as_millis()"); // remove quotes added by sql lib

        return dbPgQuery.queryP(query, []).then((result: any) => {
          res.json({});
        });
      })
      .catch((err: any) => {
        Log.fail(res, 500, "polis_err_post_reports_misc", err);
      })
  );
}
function handle_GET_reports(
  req: { p: { zid: any; rid: any; uid?: any } },
  res: { json: (arg0: any) => void }
) {
  let zid = req.p.zid;
  let rid = req.p.rid;
  let uid = req.p.uid;

  let reportsPromise = null;

  if (rid) {
    if (zid) {
      reportsPromise = Promise.reject(
        "polis_err_get_reports_should_not_specify_both_report_id_and_conversation_id"
      );
    } else {
      reportsPromise = dbPgQuery.queryP(
        "select * from reports where rid = ($1);",
        [rid]
      );
    }
  } else if (zid) {
    reportsPromise = isModerator(zid, uid).then((doesOwnConversation: any) => {
      if (!doesOwnConversation) {
        throw "polis_err_permissions";
      }
      return dbPgQuery.queryP("select * from reports where zid = ($1);", [zid]);
    });
  } else {
    reportsPromise = dbPgQuery.queryP(
      "select * from reports where zid in (select zid from conversations where owner = ($1));",
      [uid]
    );
  }

  reportsPromise
    //     Argument of type '(reports: any[]) => void | globalThis.Promise<void>' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.
    // Types of parameters 'reports' and 'value' are incompatible.
    //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
    // @ts-ignore
    .then((reports: any[]) => {
      let zids: any[] = [];
      reports = reports.map((report: { zid: any; rid: any }) => {
        zids.push(report.zid);
        delete report.rid;
        return report;
      });

      if (zids.length === 0) {
        return res.json(reports);
      }
      return dbPgQuery
        .queryP(
          "select * from zinvites where zid in (" + zids.join(",") + ");",
          []
        )
        .then((zinvite_entries: any) => {
          let zidToZinvite = _.indexBy(zinvite_entries, "zid");
          reports = reports.map(
            (report: { conversation_id: any; zid?: string | number }) => {
              report.conversation_id = zidToZinvite[report.zid || ""]?.zinvite;
              delete report.zid;
              return report;
            }
          );
          res.json(reports);
        });
    })
    .catch((err: string) => {
      if (err === "polis_err_permissions") {
        Log.fail(res, 403, "polis_err_permissions");
      } else if (
        err ===
        "polis_err_get_reports_should_not_specify_both_report_id_and_conversation_id"
      ) {
        Log.fail(
          res,
          404,
          "polis_err_get_reports_should_not_specify_both_report_id_and_conversation_id"
        );
      } else {
        Log.fail(res, 500, "polis_err_get_reports_misc", err);
      }
    });
}

function handle_GET_conversations(
  req: {
    p: ConversationType;
  },
  res: any
) {
  let courseIdPromise = Promise.resolve();
  if (req.p.course_invite) {
    // Type 'Promise<void>' is missing the following properties from type 'Bluebird<void>': caught, error, lastly, bind, and 38 more.ts(2740)
    // @ts-ignore
    courseIdPromise = dbPgQuery
      .queryP_readOnly(
        "select course_id from courses where course_invite = ($1);",
        [req.p.course_invite]
      )
      //       Argument of type '(rows: { course_id: any; }[]) => any' is not assignable to parameter of type '(value: unknown) => any'.
      // Types of parameters 'rows' and 'value' are incompatible.
      //   Type 'unknown' is not assignable to type '{ course_id: any; }[]'.ts(2345)
      // @ts-ignore
      .then(function (rows: { course_id: any }[]) {
        return rows[0].course_id;
      });
  }
  courseIdPromise.then(function (course_id: any) {
    if (course_id) {
      req.p.course_id = course_id;
    }
    let lang = null; // for now just return the default
    if (req.p.zid) {
      getOneConversation(req.p.zid, req.p.uid, lang)
        .then(
          function (data: any) {
            finishOne(res, data);
          },
          function (err: any) {
            Log.fail(res, 500, "polis_err_get_conversations_2", err);
          }
        )
        .catch(function (err: any) {
          Log.fail(res, 500, "polis_err_get_conversations_1", err);
        });
    } else if (req.p.uid || req.p.context) {
      getConversations(req, res);
    } else {
      Log.fail(res, 403, "polis_err_need_auth");
    }
  });
}

function handle_GET_contexts(
  req: any,
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: any): void; new (): any };
    };
  }
) {
  dbPgQuery
    .queryP_readOnly(
      "select name from contexts where is_public = TRUE order by name;",
      []
    )
    .then(
      function (contexts: any) {
        res.status(200).json(contexts);
      },
      function (err: any) {
        Log.fail(res, 500, "polis_err_get_contexts_query", err);
      }
    )
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_get_contexts_misc", err);
    });
}

function handle_POST_contexts(
  req: { p: { uid?: any; name: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: {}): void; new (): any };
    };
  }
) {
  let uid = req.p.uid;
  let name = req.p.name;

  function createContext() {
    return dbPgQuery
      .queryP(
        "insert into contexts (name, creator, is_public) values ($1, $2, $3);",
        [name, uid, true]
      )
      .then(
        function () {
          res.status(200).json({});
        },
        function (err: any) {
          Log.fail(res, 500, "polis_err_post_contexts_query", err);
        }
      )
      .catch(function (err: any) {
        Log.fail(res, 500, "polis_err_post_contexts_misc", err);
      });
  }
  dbPgQuery
    .queryP("select name from contexts where name = ($1);", [name])
    .then(
      //       Argument of type '(rows: string | any[]) => Promise<void> | undefined' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void | undefined> | undefined'.
      // Types of parameters 'rows' and 'value' are incompatible.
      //   Type 'unknown' is not assignable to type 'string | any[]'.
      //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
      // @ts-ignore
      function (rows: string | any[]) {
        let exists = rows && rows.length;
        if (exists) {
          Log.fail(res, 422, "polis_err_post_context_exists");
          return;
        }
        return createContext();
      },
      function (err: any) {
        Log.fail(res, 500, "polis_err_post_contexts_check_query", err);
      }
    )
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_post_contexts_check_misc", err);
    });
}

function handle_POST_reserve_conversation_id(
  req: any,
  res: { json: (arg0: { conversation_id: any }) => void }
) {
  const zid = 0;
  const shortUrl = false;
  // TODO check auth - maybe bot has key
  CreateUser.generateAndRegisterZinvite(zid, shortUrl)
    .then(function (conversation_id: any) {
      res.json({
        conversation_id: conversation_id,
      });
    })
    .catch((err: any) => {
      Log.fail(res, 500, "polis_err_reserve_conversation_id", err);
    });
}
function handle_POST_conversations(
  req: {
    p: {
      context: any;
      short_url: any;
      uid?: any;
      org_id: any;
      topic: any;
      description: any;
      is_active: any;
      is_data_open: any;
      is_draft: any;
      is_anon: any;
      is_slack: any;
      profanity_filter: any;
      spam_filter: any;
      strict_moderation: any;
      owner_sees_participation_stats: any;
      auth_needed_to_vote: any;
      auth_needed_to_write: any;
      auth_opt_allow_3rdparty: any;
      auth_opt_fb: any;
      auth_opt_tw: any;
      conversation_id: any;
    };
  },
  res: any
) {
  let xidStuffReady = Promise.resolve();

  xidStuffReady
    .then(() => {
      console.log("info", "context", req.p.context);
      let generateShortUrl = req.p.short_url;

      isUserAllowedToCreateConversations(
        req.p.uid,
        function (err: any, isAllowed: any) {
          if (err) {
            Log.fail(
              res,
              403,
              "polis_err_add_conversation_failed_user_check",
              err
            );
            return;
          }
          if (!isAllowed) {
            Log.fail(
              res,
              403,
              "polis_err_add_conversation_not_enabled",
              new Error("polis_err_add_conversation_not_enabled")
            );
            return;
          }
          let q = SQL.sql_conversations
            .insert({
              owner: req.p.uid, // creator
              org_id: req.p.org_id || req.p.uid, // assume the owner is the creator if there's no separate owner specified (
              topic: req.p.topic,
              description: req.p.description,
              is_active: req.p.is_active,
              is_data_open: req.p.is_data_open,
              is_draft: req.p.is_draft,
              is_public: true, // req.p.short_url,
              is_anon: req.p.is_anon,
              is_slack: req.p.is_slack,
              profanity_filter: req.p.profanity_filter,
              spam_filter: req.p.spam_filter,
              strict_moderation: req.p.strict_moderation,
              context: req.p.context || null,
              owner_sees_participation_stats:
                !!req.p.owner_sees_participation_stats,
              // Set defaults for fields that aren't set at postgres level.
              auth_needed_to_vote:
                req.p.auth_needed_to_vote ||
                constants.DEFAULTS.auth_needed_to_vote,
              auth_needed_to_write:
                req.p.auth_needed_to_write ||
                constants.DEFAULTS.auth_needed_to_write,
              auth_opt_allow_3rdparty:
                req.p.auth_opt_allow_3rdparty ||
                constants.DEFAULTS.auth_opt_allow_3rdparty,
              auth_opt_fb: req.p.auth_opt_fb || constants.DEFAULTS.auth_opt_fb,
              auth_opt_tw: req.p.auth_opt_tw || constants.DEFAULTS.auth_opt_tw,
            })
            .returning("*")
            .toString();

          dbPgQuery.query(
            q,
            [],
            function (err: any, result: { rows: { zid: any }[] }) {
              if (err) {
                if (isDuplicateKey(err)) {
                  Log.yell(err);
                  failWithRetryRequest(res);
                } else {
                  Log.fail(res, 500, "polis_err_add_conversation", err);
                }
                return;
              }

              let zid =
                result && result.rows && result.rows[0] && result.rows[0].zid;

              const zinvitePromise = req.p.conversation_id
                ? Conversation.getZidFromConversationId(
                    req.p.conversation_id
                  ).then((zid: number) => {
                    return zid === 0 ? req.p.conversation_id : null;
                  })
                : CreateUser.generateAndRegisterZinvite(zid, generateShortUrl);

              zinvitePromise
                .then(function (zinvite: null) {
                  if (zinvite === null) {
                    Log.fail(
                      res,
                      400,
                      "polis_err_conversation_id_already_in_use",
                      err
                    );
                    return;
                  }
                  // NOTE: OK to return conversation_id, because this conversation was just created by this user.
                  finishOne(res, {
                    url: buildConversationUrl(req, zinvite),
                    zid: zid,
                  });
                })
                .catch(function (err: any) {
                  Log.fail(res, 500, "polis_err_zinvite_create", err);
                });
            }
          ); // end insert
        }
      ); // end isUserAllowedToCreateConversations
    })
    .catch((err: any) => {
      Log.fail(res, 500, "polis_err_conversation_create", err);
    }); // end xidStuffReady
} // end post conversations

function handle_POST_query_participants_by_metadata(
  req: { p: { uid?: any; zid: any; pmaids: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: never[]): void; new (): any };
    };
  }
) {
  let uid = req.p.uid;
  let zid = req.p.zid;
  let pmaids = req.p.pmaids;

  if (!pmaids.length) {
    // empty selection
    return res.status(200).json([]);
  }

  function doneChecking() {
    // find list of participants who are not eliminated by the list of excluded choices.
    dbPgQuery.query_readOnly(
      // 3. invert the selection of participants, so we get those who passed the filter.
      "select pid from participants where zid = ($1) and pid not in " +
        // 2. find the people who chose those answers
        "(select pid from participant_metadata_choices where alive = TRUE and pmaid in " +
        // 1. find the unchecked answers
        "(select pmaid from participant_metadata_answers where alive = TRUE and zid = ($2) and pmaid not in (" +
        pmaids.join(",") +
        "))" +
        ")" +
        ";",
      [zid, zid],
      function (err: any, results: { rows: any }) {
        if (err) {
          Log.fail(res, 500, "polis_err_metadata_query", err);
          return;
        }
        // Argument of type 'any[]' is not assignable to parameter of type 'never[]'.ts(2345)
        // @ts-ignore
        res.status(200).json(_.pluck(results.rows, "pid"));
      }
    );
  }

  isOwnerOrParticipant(zid, uid, doneChecking);
}
function handle_POST_sendCreatedLinkToEmail(
  req: { p: { uid?: any; zid: string } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: {}): void; new (): any };
    };
  }
) {
  console.log("info", req.p);
  dbPgQuery.query_readOnly(
    "SELECT * FROM users WHERE uid = $1",
    [req.p.uid],
    function (err: any, results: { rows: UserType[] }) {
      if (err) {
        Log.fail(res, 500, "polis_err_get_email_db", err);
        return;
      }
      let email = results.rows[0].email;
      let fullname = results.rows[0].hname;
      dbPgQuery.query_readOnly(
        "select * from zinvites where zid = $1",
        [req.p.zid],
        function (err: any, results: { rows: { zinvite: any }[] }) {
          let zinvite = results.rows[0].zinvite;
          let server = Config.getServerNameWithProtocol(req);
          let createdLink = server + "/#" + req.p.zid + "/" + zinvite;
          let body =
            "" +
            "Hi " +
            fullname +
            ",\n" +
            "\n" +
            "Here's a link to the conversation you just created. Use it to invite participants to the conversation. Share it by whatever network you prefer - Gmail, Facebook, Twitter, etc., or just post it to your website or blog. Try it now! Click this link to go to your conversation: \n" +
            "\n" +
            createdLink +
            "\n" +
            "\n" +
            "With gratitude,\n" +
            "\n" +
            "The team at pol.is";

          return emailSenders
            .sendTextEmail(
              POLIS_FROM_ADDRESS,
              email,
              "Link: " + createdLink,
              body
            ).then(function () {
              res.status(200).json({});
            })
            .catch(function (err: any) {
              Log.fail(
                res,
                500,
                "polis_err_sending_created_link_to_email",
                err
              );
            });
        }
      );
    }
  );
}

function handle_POST_notifyTeam(
  req: {
    p: {
      webserver_pass: string | undefined;
      webserver_username: string | undefined;
      subject: any;
      body: any;
    };
  },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: {}): void; new (): any };
    };
  }
) {
  if (
    req.p.webserver_pass !== process.env.WEBSERVER_PASS ||
    req.p.webserver_username !== process.env.WEBSERVER_USERNAME
  ) {
    return Log.fail(res, 403, "polis_err_notifyTeam_auth");
  }
  let subject = req.p.subject;
  let body = req.p.body;
  emailTeam(subject, body)
    .then(() => {
      res.status(200).json({});
    })
    .catch((err: any) => {
      return Log.fail(res, 500, "polis_err_notifyTeam");
    });
}

function handle_POST_sendEmailExportReady(
  req: {
    p: {
      webserver_pass: string | undefined;
      webserver_username: string | undefined;
      email: any;
      conversation_id: string;
      filename: any;
    };
  },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: {}): void; new (): any };
    };
  }
) {
  if (
    req.p.webserver_pass !== process.env.WEBSERVER_PASS ||
    req.p.webserver_username !== process.env.WEBSERVER_USERNAME
  ) {
    return Log.fail(res, 403, "polis_err_sending_export_link_to_email_auth");
  }

  const domain = process.env.PRIMARY_POLIS_URL;
  const email = req.p.email;
  const subject =
    "Polis data export for conversation pol.is/" + req.p.conversation_id;
  const fromAddress = `Polis Team <${adminEmailDataExport}>`;
  const body = `Greetings

You created a data export for conversation ${domain}/${req.p.conversation_id} that has just completed. You can download the results for this conversation at the following url:

https://${domain}/api/v3/dataExport/results?filename=${req.p.filename}&conversation_id=${req.p.conversation_id}

Please let us know if you have any questions about the data.

Thanks for using Polis!
`;

  console.log("SENDING EXPORT EMAIL");
  console.log({
    domain,
    email,
    subject,
    fromAddress,
    body,
  });
  emailSenders
    .sendTextEmail(fromAddress, email, subject, body)
    .then(function () {
      res.status(200).json({});
    })
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_sending_export_link_to_email", err);
    });
}

function handle_GET_twitterBtn(
  req: { p: { dest: string; owner: string } },
  res: { redirect: (arg0: string) => void }
) {
  let dest = req.p.dest || "/inbox";
  dest = encodeURIComponent(Config.getServerNameWithProtocol(req) + dest);
  let returnUrl =
    Config.getServerNameWithProtocol(req) +
    "/api/v3/twitter_oauth_callback?owner=" +
    req.p.owner +
    "&dest=" +
    dest;

  getTwitterRequestToken(returnUrl)
    .then(function (data: string) {
      console.log("info", data);
      data += "&callback_url=" + dest;
      // data += "&callback_url=" + encodeURIComponent(Config.getServerNameWithProtocol(req) + "/foo");
      res.redirect("https://api.twitter.com/oauth/authenticate?" + data);
    })
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_twitter_auth_01", err);
    });
}

function handle_GET_twitter_oauth_callback(
  req: { p: { uid?: any; dest: any; oauth_verifier: any; oauth_token: any } },
  res: { redirect: (arg0: any) => void }
) {
  let uid = req.p.uid;
  console.log("info", "twitter oauth callback req.p", req.p);

  // TODO "Upon a successful authentication, your callback_url would receive a request containing the oauth_token and oauth_verifier parameters. Your application should verify that the token matches the request token received in step 1."

  let dest = req.p.dest;
  console.log("info", "twitter_oauth_callback uid", uid);
  console.log("info", "twitter_oauth_callback params");
  console.log("info", req.p);
  console.log("info", "twitter_oauth_callback params end");
  // this api sometimes succeeds, and sometimes fails, not sure why
  function tryGettingTwitterAccessToken() {
    return getTwitterAccessToken({
      oauth_verifier: req.p.oauth_verifier,
      oauth_token: req.p.oauth_token, // confused. needed, but docs say this: "The request token is also passed in the oauth_token portion of the header, but this will have been added by the signing process."
    });
  }
  retryFunctionWithPromise(tryGettingTwitterAccessToken, 20)
    .then(
      function (o: string) {
        console.log("info", "TWITTER ACCESS TOKEN");
        let pairs = o.split("&");
        let kv: TwitterParameters = {};
        pairs.forEach(function (pair: string) {
          let pairSplit = pair.split("=");
          let k = pairSplit[0];
          let v = pairSplit[1];
          kv[k] = v;
        });
        console.log("info", kv);
        console.log("info", "/TWITTER ACCESS TOKEN");

        // TODO - if no auth, generate a new user.

        getTwitterUserInfo(
          {
            twitter_user_id: kv.user_id,
          },
          false
        )
          .then(
            function (userStringPayload: string) {
              const u: UserType = JSON.parse(userStringPayload)[0];
              console.log("info", "TWITTER USER INFO");
              console.log("info", u);
              console.log("info", "/TWITTER USER INFO");
              return dbPgQuery
                .queryP(
                  "insert into twitter_users (" +
                    "uid," +
                    "twitter_user_id," +
                    "screen_name," +
                    "name," +
                    "followers_count," +
                    "friends_count," +
                    "verified," +
                    "profile_image_url_https," +
                    "location," +
                    "response" +
                    ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);",
                  [
                    uid,
                    u.id,
                    u.screen_name,
                    u.name,
                    u.followers_count,
                    u.friends_count,
                    u.verified,
                    u.profile_image_url_https,
                    u.location,
                    JSON.stringify(u),
                  ]
                )
                .then(
                  function () {
                    // SUCCESS
                    // There was no existing record
                    // set the user's hname, if not already set
                    dbPgQuery
                      .queryP(
                        "update users set hname = ($2) where uid = ($1) and hname is NULL;",
                        [uid, u.name]
                      )
                      .then(
                        function () {
                          // OK, ready
                          u.uid = uid;
                          res.redirect(dest);
                        },
                        function (err: any) {
                          Log.fail(
                            res,
                            500,
                            "polis_err_twitter_auth_update",
                            err
                          );
                        }
                      )
                      .catch(function (err: any) {
                        Log.fail(
                          res,
                          500,
                          "polis_err_twitter_auth_update_misc",
                          err
                        );
                      });
                  },
                  function (err: any) {
                    if (isDuplicateKey(err)) {
                      // we know the uid OR twitter_user_id is filled
                      // check if the uid is there with the same twitter_user_id - if so, redirect and good!
                      // determine which kind of duplicate
                      Promise.all([
                        dbPgQuery.queryP(
                          "select * from twitter_users where uid = ($1);",
                          [uid]
                        ),
                        dbPgQuery.queryP(
                          "select * from twitter_users where twitter_user_id = ($1);",
                          [u.id]
                        ),
                      ])
                        //                       No overload matches this call.
                        // Overload 1 of 2, '(onFulfill?: ((value: [unknown, unknown]) => Resolvable<void>) | undefined, onReject?: ((error: any) => Resolvable<void>) | undefined): Bluebird<void>', gave the following error.
                        //   Argument of type '(foo: any[][]) => void' is not assignable to parameter of type '(value: [unknown, unknown]) => Resolvable<void>'.
                        //     Types of parameters 'foo' and 'value' are incompatible.
                        //       Type '[unknown, unknown]' is not assignable to type 'any[][]'.
                        // Overload 2 of 2, '(onfulfilled?: ((value: [unknown, unknown]) => Resolvable<void>) | null | undefined, onrejected?: ((reason: any) => PromiseLike<never>) | null | undefined): Bluebird<void>', gave the following error.
                        //   Argument of type '(foo: any[][]) => void' is not assignable to parameter of type '(value: [unknown, unknown]) => Resolvable<void>'.
                        //     Types of parameters 'foo' and 'value' are incompatible.
                        //                       Type '[unknown, unknown]' is not assignable to type 'any[][]'.ts(2769)
                        // @ts-ignore
                        .then(function (foo: any[][]) {
                          let recordForUid = foo[0][0];
                          let recordForTwitterId = foo[1][0];
                          if (recordForUid && recordForTwitterId) {
                            if (recordForUid.uid === recordForTwitterId.uid) {
                              // match
                              res.redirect(dest);
                            } else {
                              // TODO_SECURITY_REVIEW
                              // both exist, but not same uid
                              switchToUser(req, res, recordForTwitterId.uid)
                                .then(function () {
                                  res.redirect(dest);
                                })
                                .catch(function (err: any) {
                                  Log.fail(
                                    res,
                                    500,
                                    "polis_err_twitter_auth_456",
                                    err
                                  );
                                });
                            }
                          } else if (recordForUid) {
                            // currently signed in user has a twitter account attached, but it's a different twitter account, and they are now signing in with a different twitter account.
                            // the newly supplied twitter account is not attached to anything.
                            Log.fail(
                              res,
                              500,
                              "polis_err_twitter_already_attached",
                              err
                            );
                          } else if (recordForTwitterId) {
                            // currently signed in user has no twitter account attached, but they just signed in with a twitter account which is attached to another user.
                            // For now, let's just have it sign in as that user.
                            // TODO_SECURITY_REVIEW
                            switchToUser(req, res, recordForTwitterId.uid)
                              .then(function () {
                                res.redirect(dest);
                              })
                              .catch(function (err: any) {
                                Log.fail(
                                  res,
                                  500,
                                  "polis_err_twitter_auth_234",
                                  err
                                );
                              });
                          } else {
                            Log.fail(res, 500, "polis_err_twitter_auth_345");
                          }
                        });

                      // else check if the uid is there and has some other screen_name - if so, ????????

                      // else check if the screen_name is there, but for a different uid - if so, ??????
                    } else {
                      Log.fail(res, 500, "polis_err_twitter_auth_05", err);
                    }
                  }
                );
            },
            function (err: any) {
              console.log("error", "failed to getTwitterUserInfo");
              Log.fail(res, 500, "polis_err_twitter_auth_041", err);
            }
          )
          .catch(function (err: any) {
            Log.fail(res, 500, "polis_err_twitter_auth_04", err);
          });
      },
      function (err: any) {
        Log.fail(res, 500, "polis_err_twitter_auth_gettoken", err);
      }
    )
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_twitter_auth_misc", err);
    });
}

function handle_GET_groupDemographics(
  req: { p: { zid: any; uid?: any; rid: any } },
  res: {
    json: (
      arg0: {
        gid: number;
        count: number;
        // convenient counts
        gender_male: number;
        gender_female: number;
        gender_null: number;
        birth_year: number;
        birth_year_count: number;
        meta_comment_agrees: {};
        meta_comment_disagrees: {};
        meta_comment_passes: {};
      }[]
    ) => void;
  }
) {
  let zid = req.p.zid;
  Promise.all([
    getPidsForGid(zid, 0, -1),
    getPidsForGid(zid, 1, -1),
    getPidsForGid(zid, 2, -1),
    getPidsForGid(zid, 3, -1),
    getPidsForGid(zid, 4, -1),
    getParticipantDemographicsForConversation(zid),
    getParticipantVotesForCommentsFlaggedWith_is_meta(zid),
    isModerator(req.p.zid, req.p.uid),
  ])
    .then((o: any[]) => {
      let groupPids = [];
      let groupStats = [];

      let meta = o[5];
      let metaVotes = o[6];
      let isMod = o[7];

      const isReportQuery = !_.isUndefined(req.p.rid);

      if (!isMod && !isReportQuery) {
        throw "polis_err_groupDemographics_auth";
      }

      for (let i = 0; i < 5; i++) {
        if (o[i] && o[i].length) {
          groupPids.push(o[i]);

          groupStats.push({
            gid: i,
            count: 0,

            // convenient counts
            gender_male: 0,
            gender_female: 0,
            gender_null: 0,
            birth_year: 0,
            birth_year_count: 0,

            meta_comment_agrees: {},
            meta_comment_disagrees: {},
            meta_comment_passes: {},
          });
        } else {
          break;
        }
      }
      meta = _.indexBy(meta, "pid");
      let pidToMetaVotes = _.groupBy(metaVotes, "pid");

      for (let i = 0; i < groupStats.length; i++) {
        // Type '{ gid: number; count: number; gender_male: number; gender_female: number;
        // gender_null: number; birth_year: number; birth_year_count: number;
        // meta_comment_agrees: { }; meta_comment_disagrees: { }; meta_comment_passes: { }; }
        // ' is missing the following properties from type 'DemographicEntry':
        // ms_birth_year_estimate_fb, ms_birth_year_count, birth_year_guess,
        // birth_year_guess_countts(2739)
        //
        // @ts-ignore
        let s: DemographicEntry = groupStats[i];
        let pids = groupPids[i];
        for (let p = 0; p < pids.length; p++) {
          let pid = pids[p];
          let ptptMeta = meta[pid];
          if (ptptMeta) {
            s.count += 1;

            // compute convenient counts
            let gender = null;
            if (_.isNumber(ptptMeta.fb_gender)) {
              gender = ptptMeta.fb_gender;
            } else if (_.isNumber(ptptMeta.gender_guess)) {
              gender = ptptMeta.gender_guess;
            } else if (_.isNumber(ptptMeta.ms_gender_estimate_fb)) {
              gender = ptptMeta.ms_gender_estimate_fb;
            }
            if (gender === 0) {
              s.gender_male += 1;
            } else if (gender === 1) {
              s.gender_female += 1;
            } else {
              s.gender_null += 1;
            }
            let birthYear = null;
            if (ptptMeta.ms_birth_year_estimate_fb > 1900) {
              birthYear = ptptMeta.ms_birth_year_estimate_fb;
            } else if (ptptMeta.birth_year_guess > 1900) {
              birthYear = ptptMeta.birth_year_guess;
            }
            if (birthYear > 1900) {
              s.birth_year += birthYear;
              s.birth_year_count += 1;
            }
          }
          let ptptMetaVotes = pidToMetaVotes[pid];
          if (ptptMetaVotes) {
            for (let v = 0; v < ptptMetaVotes.length; v++) {
              let vote = ptptMetaVotes[v];
              if (vote.vote === Utils.polisTypes.reactions.pass) {
                // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
                // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
                // @ts-ignore
                s.meta_comment_passes[vote.tid] =
                  // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
                  // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
                  // @ts-ignore
                  1 + (s.meta_comment_passes[vote.tid] || 0);
              } else if (vote.vote === Utils.polisTypes.reactions.pull) {
                // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
                // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
                // @ts-ignore
                s.meta_comment_agrees[vote.tid] =
                  // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
                  // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
                  // @ts-ignore
                  1 + (s.meta_comment_agrees[vote.tid] || 0);
              } else if (vote.vote === Utils.polisTypes.reactions.push) {
                // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
                // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
                // @ts-ignore
                s.meta_comment_disagrees[vote.tid] =
                  // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
                  // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
                  // @ts-ignore
                  1 + (s.meta_comment_disagrees[vote.tid] || 0);
              }
            }
          }
        }
        s.ms_birth_year_estimate_fb =
          s.ms_birth_year_estimate_fb / s.ms_birth_year_count;
        s.birth_year_guess = s.birth_year_guess / s.birth_year_guess_count;
        s.birth_year = s.birth_year / s.birth_year_count;
      }

      res.json(groupStats);
    })
    .catch((err: any) => {
      Log.fail(res, 500, "polis_err_groupDemographics", err);
    });
}

// this is for testing the encryption
function handle_GET_logMaxmindResponse(
  req: { p: { uid?: any; zid: any; user_uid?: any } },
  res: { json: (arg0: {}) => void }
) {
  if (!isPolisDev(req.p.uid) || !devMode) {
    // TODO fix this by piping the error from the usage of this in ./app
    // Cannot find name 'err'.ts(2304)
    // @ts-ignore
    return Log.fail(res, 403, "polis_err_permissions", err);
  }
  dbPgQuery
    .queryP(
      "select * from participants_extended where zid = ($1) and uid = ($2);",
      [req.p.zid, req.p.user_uid]
    )
    //     Argument of type '(results: string | any[]) => void' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.
    // Types of parameters 'results' and 'value' are incompatible.
    //   Type 'unknown' is not assignable to type 'string | any[]'.
    //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
    // @ts-ignore
    .then((results: string | any[]) => {
      if (!results || !results.length) {
        res.json({});
        console.log("NOTHING");
        return;
      }
      var o = results[0];
      _.each(o, (val: any, key: string) => {
        if (key.startsWith("encrypted_")) {
          o[key] = Session.decrypt(val);
        }
      });
      console.log(o);
      res.json({});
    })
    .catch((err: any) => {
      Log.fail(res, 500, "polis_err_get_participantsExtended", err);
    });
}

function handle_GET_locations(
  req: { p: { zid: any; gid: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: any): void; new (): any };
    };
  }
) {
  let zid = req.p.zid;
  let gid = req.p.gid;

  Promise.all([getPidsForGid(zid, gid, -1), getLocationsForParticipants(zid)])
    .then(function (o: any[]) {
      let pids = o[0];
      let locations = o[1];
      locations = locations.filter(function (locData: { pid: any }) {
        let pidIsInGroup = _.indexOf(pids, locData.pid, true) >= 0; // uses binary search
        return pidIsInGroup;
      });
      locations = locations.map(function (locData: { lat: any; lng: any }) {
        return {
          lat: locData.lat,
          lng: locData.lng,
          n: 1,
        };
      });
      res.status(200).json(locations);
    })
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_locations_01", err);
    });
}

function handle_PUT_ptptois(
  req: { p: { zid: any; uid?: any; pid: any; mod: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: {}): void; new (): any };
    };
  }
) {
  let zid = req.p.zid;
  let uid = req.p.uid;
  let pid = req.p.pid;
  let mod = req.p.mod;
  isModerator(zid, uid)
    .then(function (isMod: any) {
      if (!isMod) {
        Log.fail(res, 403, "polis_err_ptptoi_permissions_123");
        return;
      }
      return dbPgQuery
        .queryP(
          "update participants set mod = ($3) where zid = ($1) and pid = ($2);",
          [zid, pid, mod]
        )
        .then(function () {
          res.status(200).json({});
        });
    })
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_ptptoi_misc_234", err);
    });
}
function handle_GET_ptptois(
  req: { p: { zid: any; mod: any; uid?: any; conversation_id: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: any): void; new (): any };
    };
  }
) {
  let zid = req.p.zid;
  let mod = req.p.mod;
  let uid = req.p.uid;
  let limit = 99999;

  let convPromise = Conversation.getConversationInfo(req.p.zid);
  let socialPtptsPromise = convPromise.then((conv: { owner: any }) => {
    return getSocialParticipantsForMod_timed(zid, limit, mod, conv.owner);
  });

  Promise.all([socialPtptsPromise, Conversation.getConversationInfo(zid)])
    .then(function (a: any[]) {
      let ptptois = a[0];
      let conv = a[1];
      let isOwner = uid === conv.owner;
      let isAllowed = isOwner || isPolisDev(req.p.uid) || conv.is_data_open;
      if (isAllowed) {
        ptptois = ptptois.map(pullXInfoIntoSubObjects);
        ptptois = ptptois.map(removeNullOrUndefinedProperties);
        ptptois = ptptois.map(pullFbTwIntoSubObjects);
        ptptois = ptptois.map(function (p: { conversation_id: any }) {
          p.conversation_id = req.p.conversation_id;
          return p;
        });
      } else {
        ptptois = [];
      }
      res.status(200).json(ptptois);
    })
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_ptptoi_misc", err);
    });
}

function handle_GET_votes_famous(
  req: { p: any },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: any): void; new (): any };
    };
  }
) {
  doFamousQuery(req.p, req)
    .then(
      function (data: any) {
        res.status(200).json(data);
      },
      function (err: any) {
        Log.fail(res, 500, "polis_err_famous_proj_get2", err);
      }
    )
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_famous_proj_get1", err);
    });
}

function handle_GET_twitter_users(
  req: { p: { uid?: any; twitter_user_id: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: any): void; new (): any };
    };
  }
) {
  let uid = req.p.uid;
  let p;
  if (uid) {
    p = dbPgQuery.queryP_readOnly(
      "select * from twitter_users where uid = ($1);",
      [uid]
    );
  } else if (req.p.twitter_user_id) {
    p = dbPgQuery.queryP_readOnly(
      "select * from twitter_users where twitter_user_id = ($1);",
      [req.p.twitter_user_id]
    );
  } else {
    Log.fail(res, 401, "polis_err_missing_uid_or_twitter_user_id");
    return;
  }
  p.then(function (data: any) {
    data = data[0];
    data.profile_image_url_https =
      Config.getServerNameWithProtocol(req) +
      "/twitter_image?id=" +
      data.twitter_user_id;
    res.status(200).json(data);
  }).catch(function (err: any) {
    Log.fail(res, 500, "polis_err_twitter_user_info_get", err);
  });
}

function handle_GET_slack_login(
  req: { p: { uid?: any }; path: string },
  res: {
    set: (arg0: { "Content-Type": string }) => void;
    status: (arg0: number) => {
      (): any;
      new (): any;
      send: { (arg0: string): void; new (): any };
    };
  }
) {
  function finish(uid?: any) {
    startSessionAndAddCookies(req, res, uid)
      .then(function () {
        res.set({
          "Content-Type": "text/html",
        });
        let html =
          "" +
          "<!DOCTYPE html><html lang='en'>" +
          "<head>" +
          '<meta name="viewport" content="width=device-width, initial-scale=1;">' +
          "</head>" +
          "<body style='max-width:320px; font-family: Futura, Helvetica, sans-serif;'>" +
          "logged in!" +
          "</body></html>";
        res.status(200).send(html);
      })
      .catch((err: any) => {
        Log.fail(res, 500, "polis_err_slack_login_session_start", err);
      });
  }

  const existing_uid_for_client = req.p.uid;
  const token = /\/slack_login_code\/([^\/]*)/.exec(req.path)?.[1];

  dbPgQuery
    .queryP("select * from slack_user_invites where token = ($1);", [token])
    .then(
      //     Argument of type '(rows: string | any[]) => void' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.
      // Types of parameters 'rows' and 'value' are incompatible.
      //   Type 'unknown' is not assignable to type 'string | any[]'.
      //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
      // @ts-ignore
      (rows: string | any[]) => {
        if (!rows || !rows.length) {
          Log.fail(res, 500, "polis_err_slack_login_unknown_token " + token);
          return;
        }
        const row = rows[0];
        // if (row.created > foo) {
        //   Log.fail(res, 500, "polis_err_slack_login_token_expired");
        //   return;
        // }
        const slack_team = row.slack_team;
        const slack_user_id = row.slack_user_id;
        dbPgQuery
          .queryP(
            "select * from slack_users where slack_team = ($1) and slack_user_id = ($2);",
            [slack_team, slack_user_id]
          )
          .then(
            //         Argument of type '(rows: string | any[]) => void' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.
            // Types of parameters 'rows' and 'value' are incompatible.
            //   Type 'unknown' is not assignable to type 'string | any[]'.
            //         Type 'unknown' is not assignable to type 'any[]'.ts(2345)
            // @ts-ignore
            (rows: string | any[]) => {
              if (!rows || !rows.length) {
                // create new user (or use existing user) and associate a new slack_user entry
                const uidPromise = existing_uid_for_client
                  ? Promise.resolve(existing_uid_for_client)
                  : User.createDummyUser();
                uidPromise
                  .then((uid?: any) => {
                    return dbPgQuery
                      .queryP(
                        "insert into slack_users (uid, slack_team, slack_user_id) values ($1, $2, $3);",
                        [uid, slack_team, slack_user_id]
                      )
                      .then(
                        (rows: any) => {
                          finish(uid);
                        },
                        function (err: any) {
                          Log.fail(res, 500, "polis_err_slack_login_03", err);
                        }
                      );
                  })
                  .catch((err: any) => {
                    Log.fail(res, 500, "polis_err_slack_login_02", err);
                  });
              } else {
                // slack_users entry exists, so log in as that user
                finish(rows[0].uid);
              }
            },
            (err: any) => {
              Log.fail(res, 500, "polis_err_slack_login_01", err);
            }
          );
      },
      (err: any) => {
        Log.fail(res, 500, "polis_err_slack_login_misc", err);
      }
    );
}

function handle_POST_slack_interactive_messages(
  req: { p: { payload: string } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      send: { (arg0: string): void; new (): any };
    };
  }
) {
  const payload = JSON.parse(req.p.payload);

  const channel = payload.channel;
  const response_url = payload.response_url;
  const team = payload.team;
  const actions = payload.actions;

  postMessageUsingHttp({
    channel: channel.id,
    team: team.id,
    text: "woo! you voted: " + actions[0].name,
    attachments: [
      {
        text: Math.random(),
        fallback: "You are unable to choose a game",
        callback_id: "wopr_game",
        color: "#3AA3E3",
        attachment_type: "default",
        actions: [
          {
            name: "chess",
            text: "Chess",
            type: "button",
            value: "chess",
          },
          {
            name: "maze",
            text: "Falken's Maze",
            type: "button",
            value: "maze",
          },
          {
            name: "war",
            text: "Thermonuclear War",
            style: "danger",
            type: "button",
            value: "war",
            confirm: {
              title: "Are you sure?",
              text: "Wouldn't you prefer a good game of chess?",
              ok_text: "Yes",
              dismiss_text: "No",
            },
          },
        ],
      },
    ],
  })
    .then((result: any) => {
      res.status(200).send("");
    })
    .catch((err: any) => {
      Log.fail(res, 500, "polis_err_slack_interactive_messages_000", err);
    });
}

function handle_POST_slack_user_invites(
  req: { p: { slack_team: any; slack_user_id: any } },
  res: { json: (arg0: { url: string }) => void }
) {
  const slack_team = req.p.slack_team;
  const slack_user_id = req.p.slack_user_id;
  Password.generateTokenP(99, false)
    //     Argument of type '(token: string) => void' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.
    // Types of parameters 'token' and 'value' are incompatible.
    //     Type 'unknown' is not assignable to type 'string'.ts(2345)
    // @ts-ignore
    .then(function (token: string) {
      dbPgQuery
        .queryP(
          "insert into slack_user_invites (slack_team, slack_user_id, token) values ($1, $2, $3);",
          [slack_team, slack_user_id, token]
        )
        .then(
          (rows: any) => {
            res.json({
              url:
                Config.getServerNameWithProtocol(req) +
                "/slack_login_code/" +
                token,
            });
          },
          (err: any) => {
            Log.fail(res, 500, "polis_err_creating_slack_user_invite", err);
          }
        );
    });
}

function handle_POST_einvites(
  req: { p: { email: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: {}): void; new (): any };
    };
  }
) {
  let email = req.p.email;
  doSendEinvite(req, email)
    .then(function () {
      res.status(200).json({});
    })
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_sending_einvite", err);
    });
}

function handle_GET_einvites(
  req: { p: { einvite: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: any): void; new (): any };
    };
  }
) {
  let einvite = req.p.einvite;

  console.log("info", "select * from einvites where einvite = ($1);", [
    einvite,
  ]);
  dbPgQuery
    .queryP("select * from einvites where einvite = ($1);", [einvite])
    //     Argument of type '(rows: string | any[]) => void' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.
    // Types of parameters 'rows' and 'value' are incompatible.
    //   Type 'unknown' is not assignable to type 'string | any[]'.
    //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
    // @ts-ignore
    .then(function (rows: string | any[]) {
      if (!rows.length) {
        throw new Error("polis_err_missing_einvite");
      }
      res.status(200).json(rows[0]);
    })
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_fetching_einvite", err);
    });
}
function handle_POST_contributors(
  req: {
    p: {
      uid: null;
      agreement_version: any;
      name: any;
      email: any;
      github_id: any;
      company_name: any;
    };
  },
  res: { json: (arg0: {}) => void }
) {
  const uid = req.p.uid || null;
  const agreement_version = req.p.agreement_version;
  const name = req.p.name;
  const email = req.p.email;
  const github_id = req.p.github_id;
  const company_name = req.p.company_name;

  dbPgQuery
    .queryP(
      "insert into contributor_agreement_signatures (uid, agreement_version, github_id, name, email, company_name) " +
        "values ($1, $2, $3, $4, $5, $6);",
      [uid, agreement_version, github_id, name, email, company_name]
    )
    .then(
      () => {
        emailTeam(
          "contributer agreement signed",
          [uid, agreement_version, github_id, name, email, company_name].join(
            "\n"
          )
        );

        res.json({});
      },
      (err: any) => {
        Log.fail(res, 500, "polis_err_POST_contributors_misc", err);
      }
    );
}

function handle_POST_waitinglist(
  req: {
    p: { campaign: any; affiliation: any; role: any; email: any; name: any };
  },
  res: { json: (arg0: {}) => void }
) {
  return dbPgQuery
    .queryP(
      "insert into waitinglist (email, campaign, affiliation, role, name) values ($1, $2, $3, $4, $5);",
      [
        req.p.email,
        req.p.campaign,
        req.p.affiliation || null,
        req.p.role || null,
        req.p.name,
      ]
    )
    .then(() => {
      res.json({});
    })
    .catch((err: any) => {
      Log.fail(res, 500, "polis_err_POST_waitinglist", err);
    });
}

// TODO rename to LTI/launch
// TODO save launch contexts in mongo. For now, to err on the side of collecting extra data, let them be duplicated. Attach a timestamp too.
// TODO return HTML from the auth functions. the html should contain the token? so that ajax calls can be made.
function handle_POST_lti_setup_assignment(
  req: {
    p: {
      user_id: any;
      context_id: any;
      tool_consumer_instance_guid?: any;
      lis_outcome_service_url: any;
      uid?: any;
    };
  },
  res: any
) {
  console.log("info", req);
  // let roles = req.p.roles;
  // let isInstructor = /[iI]nstructor/.exec(roles); // others: Learner
  let user_id = req.p.user_id;
  let context_id = req.p.context_id;
  // let user_image = req.p.user_image || "";
  if (!req.p.tool_consumer_instance_guid) {
    emailBadProblemTime(
      "couldn't find tool_consumer_instance_guid, maybe this isn't Canvas?"
    );
  }

  // TODO SECURITY we need to verify the signature
  // let oauth_consumer_key = req.p.oauth_consumer_key;

  let dataSavedPromise = dbPgQuery.queryP(
    "insert into lti_single_assignment_callback_info (lti_user_id, lti_context_id, lis_outcome_service_url, stringified_json_of_post_content) values ($1, $2, $3, $4);",
    [
      user_id,
      context_id,
      req.p.lis_outcome_service_url || "",
      JSON.stringify(req.p),
    ]
  );

  Promise.all([dataSavedPromise])
    .then(function () {
      // check if signed in (NOTE that if they're in the Canvas mobile app, the cookies may be shared with the browser on the device)
      if (req.p.uid) {
        // Check if linked to this uid.
        dbPgQuery
          .queryP(
            "select * from lti_users left join users on lti_users.uid = users.uid where lti_user_id = ($1);",
            [user_id]
          )
          .then(function (rows: any) {
            // find the correct one - note: this loop may be useful in warning when people have multiple linkages
            let userForLtiUserId: any = null;
            (rows || []).forEach(function (row: { uid?: any }) {
              if (row.uid === req.p.uid) {
                userForLtiUserId = row;
              }
            });
            if (userForLtiUserId) {
              // if (teacher pays) {
              //     // you're good!
              // } else {
              //     if (you paid) {
              User.renderLtiLinkageSuccessPage(req, res, {
                // Argument of type '{ context_id: any; email: any; }' is not assignable to parameter of type '{ email: string; }'.
                // Object literal may only specify known properties, and 'context_id' does not exist in type '{ email: string; }'.ts(2345)
                // @ts-ignore
                context_id: context_id,
                // user_image: userForLtiUserId.user_image,
                email: userForLtiUserId.email,
              });
              // } else { // you (student) have not yet paid
              //     // gotta pay
              // }
              // }
            } else {
              // you are signed in, but not linked to the signed in user
              // WARNING! CLEARING COOKIES - since it's difficult to have them click a link to sign out, and then re-initiate the LTI POST request from Canvas, just sign them out now and move on.
              clearCookies(req, res);
              console.log("info", "lti_linkage didnt exist");
              // Have them sign in again, since they weren't linked.
              // NOTE: this could be streamlined by showing a sign-in page that also says "you are signed in as foo, link account foo? OR sign in as someone else"
              renderLtiLinkagePage(req, res);
            }
          })
          .catch(function (err: any) {
            Log.fail(res, 500, "polis_err_launching_lti_finding_user", err);
          });
      } else {
        // no uid (no cookies)
        // Have them sign in to set up the linkage
        console.log("info", "lti_linkage - no uid");
        renderLtiLinkagePage(req, res);
      }
    })
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_launching_lti_save", err);
    });
} // end /api/v3/LTI/setup_assignment

function handle_POST_lti_conversation_assignment(
  req: {
    p: {
      roles: any;
      user_id: any;
      context_id: any;
      tool_consumer_instance_guid?: any;
      lis_result_sourcedid: any;
      custom_canvas_assignment_id: any;
      lis_outcome_service_url: any;
      oauth_consumer_key: string;
    };
    body: any;
  },
  res: {
    redirect: (arg0: string) => void;
    set: (arg0: { "Content-Type": string }) => void;
    send: (arg0: string) => void;
  }
) {
  let roles = req.p.roles;
  let isInstructor = /[iI]nstructor/.exec(roles); // others: Learner
  let user_id = req.p.user_id;
  let context_id = req.p.context_id;

  console.log("info", "grades req.body " + JSON.stringify(req.body));
  console.log("info", "grades req.p " + JSON.stringify(req.p));

  // TODO SECURITY we need to verify the signature
  // let oauth_consumer_key = req.p.oauth_consumer_key;

  function getPolisUserForLtiUser() {
    return (
      dbPgQuery
        .queryP(
          "select * from lti_users left join users on lti_users.uid = users.uid where lti_users.lti_user_id = ($1) and lti_users.tool_consumer_instance_guid = ($2);",
          [user_id, req.p.tool_consumer_instance_guid]
        )
        //       Argument of type '(rows: string | any[]) => any' is not assignable to parameter of type '(value: unknown) => any'.
        // Types of parameters 'rows' and 'value' are incompatible.
        //   Type 'unknown' is not assignable to type 'string | any[]'.
        //       Type 'unknown' is not assignable to type 'any[]'.ts(2345)
        // @ts-ignore
        .then(function (rows: string | any[]) {
          let userForLtiUserId = null;
          if (rows.length) {
            userForLtiUserId = rows[0];
            console.log(
              "info",
              "got user for lti_user_id:" + JSON.stringify(userForLtiUserId)
            );
          }
          return userForLtiUserId;
        })
    );
  }

  if (req.p.lis_result_sourcedid) {
    addCanvasAssignmentConversationCallbackParamsIfNeeded(
      req.p.user_id,
      req.p.context_id,
      req.p.custom_canvas_assignment_id,
      req.p.tool_consumer_instance_guid,
      req.p.lis_outcome_service_url,
      req.p.lis_result_sourcedid,
      JSON.stringify(req.body)
    )
      .then(function () {
        console.log("info", "grading info added");
      })
      .catch(function (err: any) {
        console.log("info", "grading info error ");
        console.log("info", err);
      });
  }
  function constructConversationUrl(zid: any) {
    // sweet! the instructor has created the conversation. send students here. (instructors too)
    return getZinvite(zid).then(function (zinvite: string) {
      return (
        Config.getServerNameWithProtocol(req) +
        "/" +
        zinvite +
        "/" +
        encodeParams({
          forceEmbedded: true,
          // this token is used to support cookie-less participation, mainly needed within Canvas's Android webview
          xPolisLti: Session.createPolisLtiToken(
            req.p.tool_consumer_instance_guid,
            req.p.user_id
          ), // x-polis-lti header
        })
      );
    });
  }

  Promise.all([
    getCanvasAssignmentInfo(
      req.p.tool_consumer_instance_guid,
      req.p.context_id,
      req.p.custom_canvas_assignment_id
    ),
    getPolisUserForLtiUser(),
  ])
    .then(function (results: any[]) {
      let infos = results[0];
      let exists = infos && infos.length;
      let info = infos[0];

      let user = results[1];

      if (exists) {
        return constructConversationUrl(info.zid)
          .then(function (url: any) {
            if (user) {
              // we're in business, user can join the conversation
              res.redirect(url);
            } else {
              // not linked yet.
              // send them to an auth page, which should do the linkage, then send them to inbox with the funky params...

              // you are signed in, but not linked to the signed in user
              // WARNING! CLEARING COOKIES - since it's difficult to have them click a link to sign out, and then re-initiate the LTI POST request from Canvas, just sign them out now and move on.
              clearCookies(req, res);
              console.log("info", "lti_linkage didnt exist");
              // Have them sign in again, since they weren't linked.
              // NOTE: this could be streamlined by showing a sign-in page that also says "you are signed in as foo, link account foo? OR sign in as someone else"
              //
              // (parameter) res: {
              //     redirect: (arg0: string) => void;
              //     set: (arg0: {
              //         "Content-Type": string;
              //     }) => void;
              //     send: (arg0: string) => void;
              // }
              // Argument of type '{ redirect: (arg0: string) => void; set: (arg0: { "Content-Type": string; }) => void; send: (arg0: string) => void; }' is not assignable to parameter of type '{ set: (arg0: { "Content-Type": string; }) => void; status: (arg0: number) => { (): any; new (): any; send: { (arg0: string): void; new (): any; }; }; }'.ts(2345)
              //
              // @ts-ignore
              renderLtiLinkagePage(req, res, url);
            }
          })
          .catch(function (err: any) {
            Log.fail(
              res,
              500,
              "polis_err_lti_generating_conversation_url",
              err
            );
          });
      } else {
        // uh oh, not ready. If this is an instructor, we'll send them to the create/conversation page.
        if (isInstructor) {
          if (user) {
            res.redirect(
              Config.getServerNameWithProtocol(req) +
                "/conversation/create/" +
                encodeParams({
                  forceEmbedded: true,
                  // this token is used to support cookie-less participation, mainly needed within Canvas's Android webview. It is needed to ensure the canvas user is bound to the polis user, regardless of who is signed in on pol.is
                  xPolisLti: Session.createPolisLtiToken(
                    req.p.tool_consumer_instance_guid,
                    req.p.user_id
                  ), // x-polis-lti header
                  tool_consumer_instance_guid:
                    req.p.tool_consumer_instance_guid,
                  context: context_id,
                  custom_canvas_assignment_id:
                    req.p.custom_canvas_assignment_id,
                })
            );
          } else {
            let url =
              Config.getServerNameWithProtocol(req) +
              "/conversation/create/" +
              encodeParams({
                forceEmbedded: true,
                tool_consumer_instance_guid: req.p.tool_consumer_instance_guid,
                context: context_id,
                custom_canvas_assignment_id: req.p.custom_canvas_assignment_id,
              });
            // Argument of type '{ redirect: (arg0: string) => void; set: (arg0: { "Content-Type": string; }) => void; send: (arg0: string) => void; }' is not assignable to parameter of type '{ set: (arg0: { "Content-Type": string; }) => void; status: (arg0: number) => { (): any; new (): any; send: { (arg0: string): void; new (): any; }; }; }'.
            //   Property 'status' is missing in type '{ redirect: (arg0: string) => void; set: (arg0: { "Content-Type": string; }) => void; send: (arg0: string) => void; }' but required in type '{ set: (arg0: { "Content-Type": string; }) => void; status: (arg0: number) => { (): any; new (): any; send: { (arg0: string): void; new (): any; }; }; }'.ts(2345)
            // @ts-ignore
            renderLtiLinkagePage(req, res, url);
          }
        } else {
          // double uh-oh, a student is seeing this before the instructor created a conversation...

          // TODO email polis team, email instructor?
          // TODO or just auto-generate a conversation for the instructor, and have no topic and description, then show that?
          // TODO or make a dummy "not ready yet" page

          console.error(
            "Student saw conversation before it was set up. For instructor with key: oauth_consumer_key: " +
              req.p.oauth_consumer_key
          );
          res.set({
            "Content-Type": "text/html",
          });
          res.send(
            '<head><meta name="viewport" content="width=device-width, initial-scale=1;"></head>' +
              "<body><h1 style='max-width:320px'>Sorry, the pol.is conversation has not been created yet. Please try back later.</h1></body>"
          );
        }
      }
    })
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_checking_grading_context", err);
    });

  // store info about class, if not there already
  // dbPgQuery.queryP("insert into canvas_assignment_conversation_info (

  // we could store them all
  // we could upsert
  // but we'll need to know the uid to post the grades when the vote happens.
  // ON VOTE?
  // nope. Canvas sends them an email. It would be weird to vote once and then get an email saying you have 10/10.
  //check if conversation has context
  // if so, fetch lti_user_id for the uid and the correct tool_consumer_instance_guid (TODO)
  // lti_single_assignment_callback_info for the context, custom_canvas_assignment_id, lti_user_id
  // and do the post with that info...

  // ON CLOSE?
  // teacher has to manually close the conversation.
  // we need to provide UI for that. either in the custom inbox, or in the conversation itself.
  // so, on conversation close... we should keep "canvas_assignment_conversation_info": a many-to-many mapping of {zid <=> (tool_consumer_instance_guid, lti_context_id, custom_canvas_assignment_id)}
  // so iterate over all triples for the zid, and find the corresponding callback record, and make a signed request for each student's record.
  // Note that if the student somehow joined the conversation, but not through canvas, then they can't get credit.
  // wait! how do we know what the conversation should have for topic / description?
}

function handle_GET_setup_assignment_xml(
  req: any,
  res: {
    set: (arg0: string, arg1: string) => void;
    status: (arg0: number) => {
      (): any;
      new (): any;
      send: { (arg0: string): void; new (): any };
    };
  }
) {
  let xml =
    "" +
    '<cartridge_basiclti_link xmlns="http://www.imsglobal.org/xsd/imslticc_v1p0" xmlns:blti="http://www.imsglobal.org/xsd/imsbasiclti_v1p0" xmlns:lticm="http://www.imsglobal.org/xsd/imslticm_v1p0" xmlns:lticp="http://www.imsglobal.org/xsd/imslticp_v1p0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/imslticc_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imslticc_v1p0.xsd http://www.imsglobal.org/xsd/imsbasiclti_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imsbasiclti_v1p0.xsd http://www.imsglobal.org/xsd/imslticm_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imslticm_v1p0.xsd http://www.imsglobal.org/xsd/imslticp_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imslticp_v1p0.xsd">' +
    "<blti:title>Polis Setup Assignment</blti:title>" +
    "<blti:description>based on Minecraft LMS integration</blti:description>" +
    "<blti:icon>" +
    "http://minecraft.inseng.net:8133/minecraft-16x16.png" +
    "</blti:icon>" +
    "<blti:launch_url>https://preprod.pol.is/api/v3/LTI/setup_assignment</blti:launch_url>" +
    "<blti:custom>" +
    '<lticm:property name="custom_canvas_xapi_url">$Canvas.xapi.url</lticm:property>' +
    "</blti:custom>" +
    '<blti:extensions platform="canvas.instructure.com">' +
    '<lticm:property name="tool_id">polis_lti</lticm:property>' +
    '<lticm:property name="privacy_level">public</lticm:property>' +
    // homework 1 (link accounts)
    // https://canvas.instructure.com/doc/api/file.homework_submission_tools.html
    '<lticm:options name="homework_submission">' +
    // This is the URL that will be POSTed to when users click the button in any rich editor.
    '<lticm:property name="url">https://preprod.pol.is/api/v3/LTI/setup_assignment</lticm:property>' +
    '<lticm:property name="icon_url">' +
    "http://minecraft.inseng.net:8133/minecraft-16x16.png" +
    "</lticm:property>" +
    '<lticm:property name="text">polis accout setup (first assignment)</lticm:property>' +
    '<lticm:property name="selection_width">400</lticm:property>' +
    '<lticm:property name="selection_height">300</lticm:property>' +
    '<lticm:property name="enabled">true</lticm:property>' +
    "</lticm:options>" +
    "</blti:extensions>" +
    '<cartridge_bundle identifierref="BLTI001_Bundle"/>' +
    '<cartridge_icon identifierref="BLTI001_Icon"/>' +
    "</cartridge_basiclti_link>";

  res.set("Content-Type", "text/xml");
  res.status(200).send(xml);
}
function handle_GET_conversation_assigmnent_xml(
  req: any,
  res: {
    set: (arg0: string, arg1: string) => void;
    status: (arg0: number) => {
      (): any;
      new (): any;
      send: { (arg0: string): void; new (): any };
    };
  }
) {
  let serverName = Config.getServerNameWithProtocol(req);

  let xml =
    "" +
    '<cartridge_basiclti_link xmlns="http://www.imsglobal.org/xsd/imslticc_v1p0" xmlns:blti="http://www.imsglobal.org/xsd/imsbasiclti_v1p0" xmlns:lticm="http://www.imsglobal.org/xsd/imslticm_v1p0" xmlns:lticp="http://www.imsglobal.org/xsd/imslticp_v1p0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/imslticc_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imslticc_v1p0.xsd http://www.imsglobal.org/xsd/imsbasiclti_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imsbasiclti_v1p0.xsd http://www.imsglobal.org/xsd/imslticm_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imslticm_v1p0.xsd http://www.imsglobal.org/xsd/imslticp_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imslticp_v1p0.xsd">' +
    "<blti:title>Polis Conversation Setup</blti:title>" +
    "<blti:description>Polis conversation</blti:description>" +
    // '<blti:icon>' +
    // 'http://minecraft.inseng.net:8133/minecraft-16x16.png' +
    // '</blti:icon>' +
    "<blti:launch_url>" +
    serverName +
    "/api/v3/LTI/conversation_assignment</blti:launch_url>" +
    "<blti:custom>" +
    '<lticm:property name="custom_canvas_xapi_url">$Canvas.xapi.url</lticm:property>' +
    "</blti:custom>" +
    '<blti:extensions platform="canvas.instructure.com">' +
    '<lticm:property name="tool_id">polis_conversation_lti</lticm:property>' +
    '<lticm:property name="privacy_level">public</lticm:property>' +
    // homework 2 (polis discussions)
    // https://canvas.instructure.com/doc/api/file.homework_submission_tools.html
    '<lticm:options name="homework_submission">' +
    // '<lticm:property name="url">https://preprod.pol.is/api/v3/LTI/homework_submission</lticm:property>' +
    '<lticm:property name="url">' +
    serverName +
    "/api/v3/LTI/conversation_assignment</lticm:property>" + // ?
    '<lticm:property name="icon_url">' +
    "http://minecraft.inseng.net:8133/minecraft-16x16.png" +
    "</lticm:property>" +
    '<lticm:property name="text">polis setup</lticm:property>' +
    '<lticm:property name="selection_width">400</lticm:property>' +
    '<lticm:property name="selection_height">300</lticm:property>' +
    '<lticm:property name="enabled">true</lticm:property>' +
    "</lticm:options>" +
    "</blti:extensions>" +
    '<cartridge_bundle identifierref="BLTI001_Bundle"/>' +
    '<cartridge_icon identifierref="BLTI001_Icon"/>' +
    "</cartridge_basiclti_link>";

  res.set("Content-Type", "text/xml");
  res.status(200).send(xml);
}
function handle_GET_canvas_app_instructions_png(
  req: { headers?: { [x: string]: string } },
  res: any
) {
  let path = "/landerImages/";
  if (/Android/.exec(req?.headers?.["user-agent"] || "")) {
    path += "app_instructions_android.png";
  } else if (/iPhone.*like Mac OS X/.exec(req?.headers?.["user-agent"] || "")) {
    path += "app_instructions_ios.png";
  } else {
    path += "app_instructions_blank.png";
  }
  let doFetch = makeFileFetcher(hostname, portForParticipationFiles, path, {
    "Content-Type": "image/png",
  });
  //   Argument of type '{ headers?: { [x: string]: string; } | undefined; }' is not assignable to parameter of type '{ headers?: { host: any; } | undefined; path: any; pipe: (arg0: any) => void; }'.
  // Type '{ headers?: { [x: string]: string; } | undefined; }' is missing the following properties from type '{ headers?: { host: any; } | undefined; path: any; pipe: (arg0: any) => void; }': path, pipets(2345)
  // @ts-ignore
  doFetch(req, res);
}

function hangle_GET_testConnection(
  req: any,
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: { status: string }): void; new (): any };
    };
  }
) {
  res.status(200).json({
    status: "ok",
  });
}

function hangle_GET_testDatabase(
  req: any,
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: { status: string }): void; new (): any };
    };
  }
) {
  dbPgQuery.queryP("select uid from users limit 1", []).then(
    (rows: any) => {
      res.status(200).json({
        status: "ok",
      });
    },
    (err: any) => {
      Log.fail(res, 500, "polis_err_testDatabase", err);
    }
  );
}

function handle_POST_users_invite(
  req: { p: { uid?: any; emails: any; zid: any; conversation_id: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: { status: string }): void; new (): any };
    };
  }
) {
  let uid = req.p.uid;
  let emails = req.p.emails;
  let zid = req.p.zid;
  let conversation_id = req.p.conversation_id;

  Conversation.getConversationInfo(zid)
    .then(function (conv: { owner: any }) {
      let owner = conv.owner;

      // generate some tokens
      // add them to a table paired with user_ids
      // return URLs with those.
      generateSUZinvites(emails.length)
        .then(function (suzinviteArray: any) {
          let pairs = _.zip(emails, suzinviteArray);

          let valuesStatements = pairs.map(function (pair: any[]) {
            let xid = escapeLiteral(pair[0]);
            let suzinvite = escapeLiteral(pair[1]);
            let statement =
              "(" + suzinvite + ", " + xid + "," + zid + "," + owner + ")";
            console.log("info", statement);
            return statement;
          });
          let query =
            "INSERT INTO suzinvites (suzinvite, xid, zid, owner) VALUES " +
            valuesStatements.join(",") +
            ";";
          console.log("info", query);
          dbPgQuery.query(query, [], function (err: any, results: any) {
            if (err) {
              Log.fail(res, 500, "polis_err_saving_invites", err);
              return;
            }

            Promise.all(
              pairs.map(function (pair: any[]) {
                let email = pair[0];
                let suzinvite = pair[1];
                return sendSuzinviteEmail(
                  req,
                  email,
                  conversation_id,
                  suzinvite
                ).then(
                  function () {
                    return addInviter(uid, email);
                  },
                  function (err: any) {
                    Log.fail(res, 500, "polis_err_sending_invite", err);
                  }
                );
              })
            )
              .then(function () {
                res.status(200).json({
                  status: ":-)",
                });
              })
              .catch(function (err: any) {
                Log.fail(res, 500, "polis_err_sending_invite", err);
              });
          });
        })
        .catch(function (err: any) {
          Log.fail(res, 500, "polis_err_generating_invites", err);
        });
    })
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_getting_conversation_info", err);
    });
}

function handle_GET_conversationPreloadInfo(
  req: { p: { conversation_id: any } },
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: any): void; new (): any };
    };
  }
) {
  return doGetConversationPreloadInfo(req.p.conversation_id).then(
    (conv: any) => {
      res.status(200).json(conv);
    },
    (err: any) => {
      Log.fail(res, 500, "polis_err_get_conversation_preload_info", err);
    }
  );
}

// NOTE: this isn't optimal
// rather than code for a new URL scheme for implicit conversations,
// the idea is to redirect implicitly created conversations
// to their zinvite based URL after creating the conversation.
// To improve conversation load time, this should be changed so that it
// does not redirect, and instead serves up the index.
// The routers on client and server will need to be updated for that
// as will checks like isParticipationView on the client.
function handle_GET_implicit_conversation_generation(
  req: {
    path: string;
    p: {
      demo: any;
      ucv: any;
      ucw: any;
      ucsh: any;
      ucst: any;
      ucsd: any;
      ucsv: any;
      ucsf: any;
      ui_lang: any;
      subscribe_type: any;
      xid: any;
      x_name: any;
      x_profile_image_url: any;
      x_email: any;
      parent_url: any;
      dwok: any;
      build: any;
      show_vis: any;
      bg_white: any;
      show_share: any;
      referrer: any;
    };
    headers?: { origin: string };
  },
  res: { redirect: (arg0: string) => void }
) {
  let site_id = /polis_site_id[^\/]*/.exec(req.path) || null;
  let page_id = /\S\/([^\/]*)/.exec(req.path) || null;
  if (!site_id?.length || (page_id && page_id?.length < 2)) {
    Log.fail(res, 404, "polis_err_parsing_site_id_or_page_id");
  }
  // Type 'string | undefined' is not assignable to type 'RegExpExecArray | null'.
  //   Type 'undefined' is not assignable to type 'RegExpExecArray | null'.ts(2322)
  // @ts-ignore
  site_id = site_id?.[0];
  // Type 'string | undefined' is not assignable to type 'RegExpExecArray | null'.ts(2322)
  // @ts-ignore
  page_id = page_id?.[1];

  let demo = req.p.demo;
  let ucv = req.p.ucv;
  let ucw = req.p.ucw;
  let ucsh = req.p.ucsh;
  let ucst = req.p.ucst;
  let ucsd = req.p.ucsd;
  let ucsv = req.p.ucsv;
  let ucsf = req.p.ucsf;
  let ui_lang = req.p.ui_lang;
  let subscribe_type = req.p.subscribe_type;
  let xid = req.p.xid;
  let x_name = req.p.x_name;
  let x_profile_image_url = req.p.x_profile_image_url;
  let x_email = req.p.x_email;
  let parent_url = req.p.parent_url;
  let dwok = req.p.dwok;
  let build = req.p.build;
  let o: ConversationType = {};
  ifDefinedSet("parent_url", req.p, o);
  ifDefinedSet("auth_needed_to_vote", req.p, o);
  ifDefinedSet("auth_needed_to_write", req.p, o);
  ifDefinedSet("auth_opt_fb", req.p, o);
  ifDefinedSet("auth_opt_tw", req.p, o);
  ifDefinedSet("auth_opt_allow_3rdparty", req.p, o);
  ifDefinedSet("topic", req.p, o);
  if (!_.isUndefined(req.p.show_vis)) {
    o.vis_type = req.p.show_vis ? 1 : 0;
  }
  if (!_.isUndefined(req.p.bg_white)) {
    o.bgcolor = req.p.bg_white ? "#fff" : null;
  }
  o.socialbtn_type = req.p.show_share ? 1 : 0;
  // Set stuff in cookies to be retrieved when POST participants is called.
  let setOnPolisDomain = !Config.domainOverride;
  let origin = req?.headers?.origin || "";
  if (setOnPolisDomain && origin.match(/^http:\/\/localhost:[0-9]{4}/)) {
    setOnPolisDomain = false;
  }
  if (req.p.referrer) {
    cookies.setParentReferrerCookie(req, res, setOnPolisDomain, req.p.referrer);
  }
  if (req.p.parent_url) {
    cookies.setParentUrlCookie(req, res, setOnPolisDomain, req.p.parent_url);
  }

  function appendParams(url: string) {
    // These are needed to disambiguate postMessages from multiple polis conversations embedded on one page.
    url += "?site_id=" + site_id + "&page_id=" + page_id;
    if (!_.isUndefined(ucv)) {
      url += "&ucv=" + ucv;
    }
    if (!_.isUndefined(ucw)) {
      url += "&ucw=" + ucw;
    }
    if (!_.isUndefined(ucst)) {
      url += "&ucst=" + ucst;
    }
    if (!_.isUndefined(ucsd)) {
      url += "&ucsd=" + ucsd;
    }
    if (!_.isUndefined(ucsv)) {
      url += "&ucsv=" + ucsv;
    }
    if (!_.isUndefined(ucsf)) {
      url += "&ucsf=" + ucsf;
    }
    if (!_.isUndefined(ui_lang)) {
      url += "&ui_lang=" + ui_lang;
    }
    if (!_.isUndefined(ucsh)) {
      url += "&ucsh=" + ucsh;
    }
    if (!_.isUndefined(subscribe_type)) {
      url += "&subscribe_type=" + subscribe_type;
    }
    if (!_.isUndefined(xid)) {
      url += "&xid=" + xid;
    }
    if (!_.isUndefined(x_name)) {
      url += "&x_name=" + encodeURIComponent(x_name);
    }
    if (!_.isUndefined(x_profile_image_url)) {
      url += "&x_profile_image_url=" + encodeURIComponent(x_profile_image_url);
    }
    if (!_.isUndefined(x_email)) {
      url += "&x_email=" + encodeURIComponent(x_email);
    }
    if (!_.isUndefined(parent_url)) {
      url += "&parent_url=" + encodeURIComponent(parent_url);
    }
    if (!_.isUndefined(dwok)) {
      url += "&dwok=" + dwok;
    }
    if (!_.isUndefined(build)) {
      url += "&build=" + build;
    }
    return url;
  }

  // also parse out the page_id after the '/', and look that up, along with site_id in the page_ids table
  dbPgQuery
    .queryP_readOnly(
      "select * from page_ids where site_id = ($1) and page_id = ($2);",
      [site_id, page_id]
    )
    //     Argument of type '(rows: string | any[]) => void' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.
    // Types of parameters 'rows' and 'value' are incompatible.
    //   Type 'unknown' is not assignable to type 'string | any[]'.
    //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
    // @ts-ignore
    .then(function (rows: string | any[]) {
      if (!rows || !rows.length) {
        // conv not initialized yet
        initializeImplicitConversation(site_id, page_id, o)
          //           Argument of type '(conv: { zinvite: any; }) => void' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.
          // Types of parameters 'conv' and 'value' are incompatible.
          //           Type 'unknown' is not assignable to type '{ zinvite: any; }'.ts(2345)
          // @ts-ignore
          .then(function (conv: { zinvite: any }) {
            let url = _.isUndefined(demo)
              ? buildConversationUrl(req, conv.zinvite)
              : buildConversationDemoUrl(req, conv.zinvite);
            let modUrl = buildModerationUrl(req, conv.zinvite);
            let seedUrl = buildSeedUrl(req, conv.zinvite);
            sendImplicitConversationCreatedEmails(
              site_id,
              page_id,
              url,
              modUrl,
              seedUrl
            )
              .then(function () {
                console.log("info", "email sent");
              })
              .catch(function (err: any) {
                console.error("email Log.fail");
                console.error(err);
              });

            url = appendParams(url);
            res.redirect(url);
          })
          .catch(function (err: any) {
            Log.fail(res, 500, "polis_err_creating_conv", err);
          });
      } else {
        // conv was initialized, nothing to set up
        getZinvite(rows[0].zid)
          .then(function (conversation_id: any) {
            let url = buildConversationUrl(req, conversation_id);
            url = appendParams(url);
            res.redirect(url);
          })
          .catch(function (err: any) {
            Log.fail(res, 500, "polis_err_finding_conversation_id", err);
          });
      }
    })
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_redirecting_to_conv", err);
    });
}

function handle_GET_iip_conversation(
  req: { params: { conversation_id: any } },
  res: {
    set: (arg0: { "Content-Type": string }) => void;
    send: (arg0: string) => void;
  }
) {
  let conversation_id = req.params.conversation_id;
  res.set({
    "Content-Type": "text/html",
  });
  res.send(
    "<a href='https://pol.is/" +
      conversation_id +
      "' target='_blank'>" +
      conversation_id +
      "</a>"
  );
}
function handle_GET_iim_conversation(
  req: { p: { zid: any }; params: { conversation_id: any } },
  res: {
    set: (arg0: { "Content-Type": string }) => void;
    send: (arg0: string) => void;
  }
) {
  let zid = req.p.zid;
  let conversation_id = req.params.conversation_id;
  Conversation.getConversationInfo(zid)
    .then(function (info: { topic: any; created: any; description: string }) {
      res.set({
        "Content-Type": "text/html",
      });
      let title = info.topic || info.created;
      res.send(
        "<a href='https://pol.is/" +
          conversation_id +
          "' target='_blank'>" +
          title +
          "</a>" +
          "<p><a href='https://pol.is/m" +
          conversation_id +
          "' target='_blank'>moderate</a></p>" +
          (info.description ? "<p>" + info.description + "</p>" : "")
      );
    })
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_fetching_conversation_info", err);
    });
}

function handle_GET_twitter_image(
  req: { p: { id: any } },
  res: {
    setHeader: (arg0: string, arg1: string) => void;
    writeHead: (arg0: number) => void;
    end: (arg0: string) => void;
    status: (arg0: number) => {
      (): any;
      new (): any;
      end: { (): void; new (): any };
    };
  }
) {
  console.log("handle_GET_twitter_image", req.p.id);
  getTwitterUserInfo(
    {
      twitter_user_id: req.p.id,
    },
    true
  )
    .then(function (data: string) {
      let parsedData = JSON.parse(data);
      if (!parsedData || !parsedData.length) {
        Log.fail(res, 500, "polis_err_finding_twitter_user_info");
        return;
      }
      const url = parsedData[0].profile_image_url; // not https to save a round-trip
      let finished = false;
      http
        .get(url, function (twitterResponse: { pipe: (arg0: any) => void }) {
          if (!finished) {
            clearTimeout(timeoutHandle);
            finished = true;
            res.setHeader(
              "Cache-Control",
              "no-transform,public,max-age=18000,s-maxage=18000"
            );
            twitterResponse.pipe(res);
          }
        })
        .on("error", function (err: any) {
          finished = true;
          Log.fail(res, 500, "polis_err_finding_file " + url, err);
        });

      let timeoutHandle = setTimeout(function () {
        if (!finished) {
          finished = true;
          res.writeHead(504);
          res.end("request timed out");
          console.log("twitter_image timeout");
        }
      }, 9999);
    })
    .catch(function (err: { stack: any }) {
      console.error("polis_err_missing_twitter_image", err);
      if (err && err.stack) {
        console.error(err.stack);
      }
      res.status(500).end();
    });
}

let handle_GET_conditionalIndexFetcher = (function () {
  return function (req: any, res: { redirect: (arg0: string) => void }) {
    if (hasAuthToken(req)) {
      // user is signed in, serve the app
      // Argument of type '{ redirect: (arg0: string) => void; }'
      // is not assignable to parameter of type '{ set: (arg0: any) => void; }'.
      //
      // Property 'set' is missing in type '{ redirect: (arg0: string) => void; }'
      // but required in type '{ set: (arg0: any) => void; }'.ts(2345)
      // @ts-ignore
      return fetchIndexForAdminPage(req, res);
    } else if (!browserSupportsPushState(req)) {
      // TEMPORARY: Don't show the landing page.
      // The problem is that /user/create redirects to #/user/create,
      // which ends up here, and since there's no auth token yet,
      // we would show the lander. One fix would be to serve up the auth page
      // as a separate html file, and not rely on JS for the routing.
      //
      // Argument of type '{ redirect: (arg0: string) => void; }'
      // is not assignable to parameter of type '{ set: (arg0: any) => void; }'.ts(2345)
      // @ts-ignore
      return fetchIndexForAdminPage(req, res);
    } else {
      // user not signed in, redirect to landing page
      let url = Config.getServerNameWithProtocol(req) + "/home";
      res.redirect(url);
    }
  };
})();

function handle_GET_localFile_dev_only(
  req: Request,
  res: {
    writeHead: (
      arg0: number,
      arg1?: { "Content-Type": string } | undefined
    ) => void;
    end: (arg0?: undefined, arg1?: string) => void;
  }
) {
  const filenameParts = String(req.path).split("/");
  filenameParts.shift();
  filenameParts.shift();
  const filename = filenameParts.join("/");
  if (!devMode) {
    // pretend this route doesn't exist.
    return proxy(req, res);
  }
  fs.readFile(filename, function (error: any, content: any) {
    if (error) {
      res.writeHead(500);
      res.end();
    } else {
      res.writeHead(200, {
        "Content-Type": "text/html",
      });
      res.end(content, "utf-8");
    }
  });
}

export {
  handle_DELETE_metadata_answers,
  handle_DELETE_metadata_questions,
  handle_GET_bid,
  handle_GET_bidToPid,
  handle_GET_canvas_app_instructions_png,
  handle_GET_comments,
  handle_GET_comments_translations,
  handle_GET_conditionalIndexFetcher,
  handle_GET_contexts,
  handle_GET_conversation_assigmnent_xml,
  handle_GET_conversationPreloadInfo,
  handle_GET_conversations,
  handle_GET_conversationsRecentActivity,
  handle_GET_conversationsRecentlyStarted,
  handle_GET_conversationStats,
  handle_GET_math_correlationMatrix,
  handle_GET_dataExport,
  handle_GET_dataExport_results,
  handle_GET_domainWhitelist,
  handle_GET_dummyButton,
  handle_GET_einvites,
  handle_GET_facebook_delete,
  handle_GET_groupDemographics,
  handle_GET_iim_conversation,
  handle_GET_iip_conversation,
  handle_GET_implicit_conversation_generation,
  handle_GET_launchPrep,
  handle_GET_localFile_dev_only,
  handle_GET_locations,
  handle_GET_logMaxmindResponse,
  handle_GET_lti_oauthv1_credentials,
  handle_GET_math_pca,
  handle_GET_math_pca2,
  handle_GET_metadata,
  handle_GET_metadata_answers,
  handle_GET_metadata_choices,
  handle_GET_metadata_questions,
  handle_GET_nextComment,
  handle_GET_notifications_subscribe,
  handle_GET_notifications_unsubscribe,
  handle_GET_participants,
  handle_GET_participation,
  handle_GET_participationInit,
  handle_GET_perfStats,
  handle_GET_ptptois,
  handle_GET_reports,
  handle_GET_setup_assignment_xml,
  handle_GET_slack_login,
  handle_GET_snapshot,
  hangle_GET_testConnection,
  hangle_GET_testDatabase,
  handle_GET_tryCookie,
  handle_GET_twitter_image,
  handle_GET_twitter_oauth_callback,
  handle_GET_twitter_users,
  handle_GET_twitterBtn,
  handle_GET_users,
  handle_GET_verification,
  handle_GET_votes,
  handle_GET_votes_famous,
  handle_GET_votes_me,
  handle_GET_xids,
  handle_GET_zinvites,
  handle_POST_auth_deregister,
  handle_POST_auth_facebook,
  handle_POST_auth_login,
  handle_POST_auth_new,
  handle_POST_auth_password,
  handle_POST_auth_pwresettoken,
  handle_POST_auth_slack_redirect_uri,
  handle_POST_comments,
  handle_POST_comments_slack,
  handle_POST_contexts,
  handle_POST_contributors,
  handle_POST_conversation_close,
  handle_POST_conversation_reopen,
  handle_POST_conversations,
  handle_POST_convSubscriptions,
  handle_POST_domainWhitelist,
  handle_POST_einvites,
  handle_POST_joinWithInvite,
  handle_POST_lti_conversation_assignment,
  handle_POST_lti_setup_assignment,
  handle_POST_math_update,
  handle_POST_metadata_answers,
  handle_POST_metadata_questions,
  handle_POST_metrics,
  handle_POST_notifyTeam,
  handle_POST_participants,
  handle_POST_ptptCommentMod,
  handle_POST_query_participants_by_metadata,
  handle_POST_reportCommentSelections,
  handle_POST_reports,
  handle_POST_reserve_conversation_id,
  handle_POST_sendCreatedLinkToEmail,
  handle_POST_sendEmailExportReady,
  handle_POST_slack_interactive_messages,
  handle_POST_slack_user_invites,
  handle_POST_stars,
  handle_POST_trashes,
  handle_POST_tutorial,
  handle_POST_upvotes,
  handle_POST_users_invite,
  handle_POST_votes,
  handle_POST_waitinglist,
  handle_POST_xidWhitelist,
  handle_POST_zinvites,
  handle_PUT_comments,
  handle_PUT_conversations,
  handle_PUT_participants_extended,
  handle_PUT_ptptois,
  handle_PUT_reports,
  handle_PUT_users,
};
