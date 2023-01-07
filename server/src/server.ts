"use strict";

import AWS from "aws-sdk";
import Promise from "bluebird";
import isTrue from "boolean";
import OAuth from "oauth";
import responseTime from "response-time";
import request from "request-promise"; // includes Request, but adds promise methods
import LruCache from "lru-cache";
import timeout from "connect-timeout";
import _ from "underscore";

import { addInRamMetric } from "./utils/metered";
import dbPgQuery from "./db/pg-query";
import cookies from "./utils/cookies";

import Config from "./config";
import Log from "./log";

import User from "./user";
import Conversation from "./conversation";
import Session from "./session";
import Comment from "./comment";
import emailSenders from "./email/senders";

import {
  Body,
  DetectLanguageResult,
  Headers,
  Query,
  AuthRequest,
  ConversationType,
} from "./d";

import {
  startSessionAndAddCookies,
  hasWhitelistMatches,
  processMathObject,
  updatePcaCache,
  doAddDataExportTask,
  clearCookies,
  makeFileFetcher,
  emailBadProblemTime,
  getZinvite,
  isPolisDev,
  createNotificationsUnsubscribeUrl,
  sendEmailByUid,
  browserSupportsPushState,
  doGetConversationPreloadInfo,
  suspendedOrPotentiallyProblematicTwitterIds,
  HMAC_SIGNATURE_PARAM_NAME,
  emailTeam,
  fetchIndexForAdminPage,
  fetchIndexForReportPage,
  proxy,
} from "./helpers";

import {
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
  handle_POST_comments,
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
} from "./handlers";

AWS.config.update({ region: process.env.AWS_REGION });
const devMode = isTrue(process.env.DEV_MODE);
const COOKIES = cookies.COOKIES;

const POLIS_FROM_ADDRESS = process.env.POLIS_FROM_ADDRESS;
const adminEmailDataExportTest = process.env.ADMIN_EMAIL_DATA_EXPORT_TEST || "";
const adminEmailEmailTest = process.env.ADMIN_EMAIL_EMAIL_TEST || "";

// serve up index.html in response to anything starting with a number
let hostname = process.env.STATIC_FILES_HOST;
let portForParticipationFiles = process.env.STATIC_FILES_PORT;
let portForAdminFiles = process.env.STATIC_FILES_ADMINDASH_PORT;

if (devMode) {
  Promise.longStackTraces();
}

// Bluebird uncaught error handler.
Promise.onPossiblyUnhandledRejection(function (err: { stack: any }) {
  console.log("onPossiblyUnhandledRejection");
  if (_.isObject(err)) {
    // since it may just throw as [object Object]
    console.error(1);
    console.dir(err);
    console.error(2);
    console.error(err);
    console.error(3);

    if (err && err.stack) {
      console.error(err.stack);
    }
    try {
      console.error(4);
      console.error(JSON.stringify(err));
    } catch (e) {
      console.error(5);
      console.error("stringify threw");
    }
  }
  console.error(6);
  // throw err; // not throwing since we're printing stack traces anyway
});

// log heap stats
setInterval(function () {
  let mem = process.memoryUsage();
  let heapUsed = mem.heapUsed;
  let rss = mem.rss;
  let heapTotal = mem.heapTotal;
  console.log(
    "info",
    "heapUsed:",
    heapUsed,
    "heapTotal:",
    heapTotal,
    "rss:",
    rss
  );
}, 10 * 1000);

// basic defaultdict implementation
function DD(this: any, f: () => { votes: number; comments: number }) {
  this.m = {};
  this.f = f;
}
// basic defaultarray implementation
function DA(this: any, f: any) {
  this.m = [];
  this.f = f;
}
DD.prototype.g = DA.prototype.g = function (k: string | number) {
  if (this.m.hasOwnProperty(k)) {
    return this.m[k];
  }
  let v = this.f(k);
  this.m[k] = v;
  return v;
};
DD.prototype.s = DA.prototype.s = function (k: string | number, v: any) {
  this.m[k] = v;
};

function haltOnTimeout(req: { timedout: any }, res: any, next: () => void) {
  if (req.timedout) {
    Log.fail(res, 500, "polis_err_timeout_misc");
  } else {
    next();
  }
}

function getUidForApiKey(apikey: any) {
  return dbPgQuery.queryP_readOnly_wRetryIfEmpty(
    "select uid from apikeysndvweifu WHERE apikey = ($1);",
    [apikey]
  );
}

function doApiKeyBasicAuth(
  assigner: any,
  header: string,
  isOptional: any,
  req: any,
  res: any,
  next: (err: any) => void
) {
  let token = header.split(/\s+/).pop() || "", // and the encoded auth token
    auth = new Buffer(token, "base64").toString(), // convert from base64
    parts = auth.split(/:/), // split on colon
    username = parts[0],
    // password = parts[1], // we don't use the password part (just use "apikey:")
    apikey = username;
  return doApiKeyAuth(assigner, apikey, isOptional, req, res, next);
}

function doApiKeyAuth(
  assigner: (arg0: any, arg1: string, arg2: number) => void,
  apikey: string,
  isOptional: any,
  req: any,
  res: { status: (arg0: number) => void },
  next: { (err: any): void; (err: any): void; (arg0?: string): void }
) {
  getUidForApiKey(apikey)
    //   Argument of type '(rows: string | any[]) => void' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.
    // Types of parameters 'rows' and 'value' are incompatible.
    //   Type 'unknown' is not assignable to type 'string | any[]'.
    //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
    // @ts-ignore
    .then(function (rows: string | any[]) {
      if (!rows || !rows.length) {
        res.status(403);
        next("polis_err_auth_no_such_api_token");
        return;
      }
      assigner(req, "uid", Number(rows[0].uid));
      next();
    })
    .catch(function (err: { stack: any }) {
      res.status(403);
      console.error(err.stack);
      next("polis_err_auth_no_such_api_token2");
    });
}

function doXidApiKeyAuth(
  assigner: (arg0: any, arg1: string, arg2: number) => void,
  apikey: any,
  xid: any,
  isOptional: any,
  req: AuthRequest,
  res: { status: (arg0: number) => void },
  next: {
    (err: any): void;
    (err: any): void;
    (arg0?: string | undefined): void;
  }
) {
  getUidForApiKey(apikey)
    .then(
      //     Argument of type '(rows: string | any[]) => Promise<void> | undefined' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void | undefined> | undefined'.
      // Types of parameters 'rows' and 'value' are incompatible.
      //   Type 'unknown' is not assignable to type 'string | any[]'.
      //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
      // @ts-ignore
      function (rows: string | any[]) {
        if (!rows || !rows.length) {
          res.status(403);
          next("polis_err_auth_no_such_api_token4");
          return;
        }
        let uidForApiKey = Number(rows[0].uid);
        return User.getXidRecordByXidOwnerId(
          xid,
          uidForApiKey,
          void 0, //zid_optional,
          req.body.x_profile_image_url || req?.query?.x_profile_image_url,
          req.body.x_name || req?.query?.x_name || null,
          req.body.x_email || req?.query?.x_email || null,
          !!req.body.agid || !!req?.query?.agid || null
          //         Argument of type '(rows: string | any[]) => void' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.
          // Types of parameters 'rows' and 'value' are incompatible.
          //   Type 'unknown' is not assignable to type 'string | any[]'.
          //         Type 'unknown' is not assignable to type 'any[]'.ts(2345)
          // @ts-ignore
        ).then((rows: string | any[]) => {
          if (!rows || !rows.length) {
            if (isOptional) {
              return next();
            } else {
              res.status(403);
              next("polis_err_auth_no_such_xid_for_this_apikey_1");
              return;
            }
          }
          let uidForCurrentUser = Number(rows[0].uid);
          assigner(req, "uid", uidForCurrentUser);
          assigner(req, "xid", xid);
          assigner(req, "owner_uid", uidForApiKey);
          assigner(req, "org_id", uidForApiKey);
          next();
        });
      },
      function (err: { stack: any }) {
        res.status(403);
        console.error(err.stack);
        next("polis_err_auth_no_such_api_token3");
      }
    )
    .catch(function (err: { stack: any }) {
      res.status(403);
      console.error(err);
      console.error(err.stack);
      next("polis_err_auth_misc_23423");
    });
}
function doHeaderAuth(
  assigner: (arg0: any, arg1: string, arg2: number) => void,
  isOptional: any,
  req: { headers?: { [x: string]: any }; body: { uid?: any } },
  res: { status: (arg0: number) => void },
  next: { (err: any): void; (arg0?: string | undefined): void }
) {
  let token = "";
  if (req && req.headers) token = req?.headers?.["x-polis"];

  Session.getUserInfoForSessionToken(
    token,
    res,
    function (err: any, uid?: any) {
      if (err) {
        res.status(403);
        next("polis_err_auth_no_such_token");
        return;
      }
      if (req.body.uid && req.body.uid !== uid) {
        res.status(401);
        next("polis_err_auth_mismatch_uid");
        return;
      }
      assigner(req, "uid", Number(uid));
      next();
    }
  );
}

function doPolisLtiTokenHeaderAuth(
  assigner: (arg0: any, arg1: string, arg2: number) => void,
  isOptional: any,
  req: { headers?: { [x: string]: any } },
  res: { status: (arg0: number) => void },
  next: { (err: any): void; (arg0?: string): void }
) {
  let token = req?.headers?.["x-polis"];

  Session.getUserInfoForPolisLtiToken(token)
    .then(function (uid?: any) {
      assigner(req, "uid", Number(uid));
      next();
    })
    .catch(function (err: any) {
      res.status(403);
      next("polis_err_auth_no_such_token");
      return;
    });
}

// @ts-ignore
String.prototype.hashCode = function () {
  let hash = 0;
  let i;
  let character;
  if (this.length === 0) {
    return hash;
  }
  for (i = 0; i < this.length; i++) {
    character = this.charCodeAt(i);
    hash = (hash << 5) - hash + character;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
};

function initializePolisHelpers() {
  if (isTrue(process.env.BACKFILL_COMMENT_LANG_DETECTION)) {
    dbPgQuery
      .queryP("select tid, txt, zid from comments where lang is null;", [])
      .then(
        //   Argument of type '(comments: string | any[]) => void' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.
        // Types of parameters 'comments' and 'value' are incompatible.
        //   Type 'unknown' is not assignable to type 'string | any[]'.
        //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
        // @ts-ignore
        (comments: string | any[]) => {
          let i = 0;
          function doNext() {
            if (i < comments.length) {
              let c = comments[i];
              i += 1;
              Comment.detectLanguage(c.txt).then(
                (x: DetectLanguageResult[]) => {
                  const firstResult = x[0];
                  console.log(
                    "backfill",
                    firstResult.language + "\t\t" + c.txt
                  );
                  dbPgQuery
                    .queryP(
                      "update comments set lang = ($1), lang_confidence = ($2) where zid = ($3) and tid = ($4)",
                      [
                        firstResult.language,
                        firstResult.confidence,
                        c.zid,
                        c.tid,
                      ]
                    )
                    .then(() => {
                      doNext();
                    });
                }
              );
            }
          }
          doNext();
        }
      );
  }

  function writeDefaultHead(
    req: any,
    res: {
      set: (arg0: {
        "Content-Type": string;
        "Cache-Control": string;
        Connection: string;
      }) => void;
    },
    next: () => void
  ) {
    res.set({
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      //    'Access-Control-Allow-Origin': '*',
      //    'Access-Control-Allow-Credentials': 'true'
    });
    next();
  }

  function redirectIfNotHttps(
    req: { headers?: { [x: string]: string; host: string }; url: string },
    res: {
      writeHead: (arg0: number, arg1: { Location: string }) => void;
      end: () => any;
    },
    next: () => any
  ) {
    let exempt = devMode;

    // IE is picky, so use HTTP.
    // TODO figure out IE situation, (proxy static files in worst-case)
    // exempt = exempt || /MSIE/.test(req?.headers?.['user-agent']); // TODO test IE11

    if (exempt) {
      return next();
    }

    if (!/https/.test(req?.headers?.["x-forwarded-proto"] || "")) {
      // assuming we're running on Heroku, where we're behind a proxy.
      res.writeHead(302, {
        Location: "https://" + req?.headers?.host + req.url,
      });
      return res.end();
    }
    return next();
  }

  function redirectIfWrongDomain(
    req: { headers?: { host: string }; url: string },
    res: {
      writeHead: (arg0: number, arg1: { Location: string }) => void;
      end: () => any;
    },
    next: () => any
  ) {
    if (/www.pol.is/.test(req?.headers?.host || "")) {
      res.writeHead(302, {
        Location: "https://pol.is" + req.url,
      });
      return res.end();
    }
    return next();
  }

  function redirectIfApiDomain(
    req: { headers?: { host: string }; url: string },
    res: {
      writeHead: (arg0: number, arg1: { Location: string }) => void;
      end: () => any;
    },
    next: () => any
  ) {
    if (/api.pol.is/.test(req?.headers?.host || "")) {
      if (req.url === "/" || req.url === "") {
        res.writeHead(302, {
          Location: "https://pol.is/docs/api",
        });
        return res.end();
      } else if (!req.url.match(/^\/?api/)) {
        res.writeHead(302, {
          Location: "https://pol.is/" + req.url,
        });
        return res.end();
      }
    }
    return next();
  }

  function doXidConversationIdAuth(
    assigner: (arg0: any, arg1: string, arg2: number) => void,
    xid: any,
    conversation_id: any,
    isOptional: any,
    req: AuthRequest,
    res: { status: (arg0: number) => void },
    onDone: { (err: any): void; (arg0?: string): void }
  ) {
    return Conversation.getConversationInfoByConversationId(conversation_id)
      .then((conv: { org_id: any; zid: any }) => {
        return User.getXidRecordByXidOwnerId(
          xid,
          conv.org_id,
          conv.zid,
          req.body.x_profile_image_url || req?.query?.x_profile_image_url,
          req.body.x_name || req?.query?.x_name || null,
          req.body.x_email || req?.query?.x_email || null,
          !!req.body.agid || !!req?.query?.agid || null
          //         Argument of type '(rows: string | any[]) => void' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.
          // Types of parameters 'rows' and 'value' are incompatible.
          //   Type 'unknown' is not assignable to type 'string | any[]'.
          //         Type 'unknown' is not assignable to type 'any[]'.ts(2345)
          // @ts-ignore
        ).then((rows: string | any[]) => {
          if (!rows || !rows.length) {
            if (isOptional) {
              return onDone();
            } else {
              res.status(403);
              onDone("polis_err_auth_no_such_xid_for_this_apikey_11");
              return;
            }
          }
          let uidForCurrentUser = Number(rows[0].uid);
          assigner(req, "uid", uidForCurrentUser);
          onDone();
        });
      })
      .catch((err: any) => {
        console.log(err);
        onDone(err);
      });
  }
  function _auth(assigner: any, isOptional: boolean) {
    function getKey(
      req: {
        body: Body;
        headers?: Headers;
        query?: Query;
      },
      key: string
    ) {
      return req.body[key] || req?.headers?.[key] || req?.query?.[key];
    }

    function doAuth(
      req: {
        cookies: { [x: string]: any };
        headers?: { [x: string]: any; authorization: any };
        p: { uid?: any };
        body: Body;
      },
      res: { status: (arg0: number) => void }
    ) {
      //var token = req.body.token;
      let token = req.cookies[cookies.COOKIES.TOKEN];
      let xPolisToken = req?.headers?.["x-polis"];

      return new Promise(function (
        resolve: (arg0: any) => void,
        reject: (arg0: string) => void
      ) {
        function onDone(err?: string) {
          if (err) {
            reject(err);
          }
          if ((!req.p || !req.p.uid) && !isOptional) {
            reject("polis_err_mandatory_auth_unsuccessful");
          }
          resolve(req.p && req.p.uid);
        }
        if (xPolisToken && Session.isPolisLtiToken(xPolisToken)) {
          console.log("authtype", "doPolisLtiTokenHeaderAuth");
          doPolisLtiTokenHeaderAuth(assigner, isOptional, req, res, onDone);
        } else if (xPolisToken) {
          console.log("authtype", "doHeaderAuth");
          doHeaderAuth(assigner, isOptional, req, res, onDone);
        } else if (getKey(req, "polisApiKey") && getKey(req, "ownerXid")) {
          console.log("authtype", "doXidApiKeyAuth");
          doXidApiKeyAuth(
            assigner,
            getKey(req, "polisApiKey"),
            getKey(req, "ownerXid"),
            isOptional,
            req,
            res,
            onDone
          );
        } else if (getKey(req, "polisApiKey") && getKey(req, "xid")) {
          console.log("authtype", "doXidApiKeyAuth");
          doXidApiKeyAuth(
            assigner,
            getKey(req, "polisApiKey"),
            getKey(req, "xid"),
            isOptional,
            req,
            res,
            onDone
          );
        } else if (getKey(req, "xid") && getKey(req, "conversation_id")) {
          console.log("authtype", "doXidConversationIdAuth");
          doXidConversationIdAuth(
            assigner,
            getKey(req, "xid"),
            getKey(req, "conversation_id"),
            isOptional,
            req,
            res,
            onDone
          );
        } else if (req?.headers?.["x-sandstorm-app-polis-apikey"]) {
          console.log("authtype", "doApiKeyAuth");
          doApiKeyAuth(
            assigner,
            req?.headers?.["x-sandstorm-app-polis-apikey"],
            isOptional,
            req,
            res,
            onDone
          );
        } else if (req.body["polisApiKey"]) {
          console.log("authtype", "doApiKeyAuth");
          doApiKeyAuth(
            assigner,
            getKey(req, "polisApiKey"),
            isOptional,
            req,
            res,
            onDone
          );
        } else if (token) {
          console.log("authtype", "doCookieAuth");
          doCookieAuth(assigner, isOptional, req, res, onDone);
        } else if (req?.headers?.authorization) {
          console.log("authtype", "doApiKeyBasicAuth");
          doApiKeyBasicAuth(
            assigner,
            req.headers.authorization,
            isOptional,
            req,
            res,
            onDone
          );
        } else if (req.body.agid) {
          // Auto Gen user  ID
          console.log("authtype", "no auth but agid");
          User.createDummyUser()
            .then(
              function (uid?: any) {
                let shouldAddCookies = _.isUndefined(req.body.xid);
                if (!shouldAddCookies) {
                  req.p = req.p || {};
                  req.p.uid = uid;
                  return onDone();
                }
                return startSessionAndAddCookies(req, res, uid).then(
                  function () {
                    req.p = req.p || {};
                    req.p.uid = uid;
                    onDone();
                  },
                  function (err: any) {
                    res.status(500);
                    console.error(err);
                    onDone("polis_err_auth_token_error_2343");
                  }
                );
              },
              function (err: any) {
                res.status(500);
                console.error(err);
                onDone("polis_err_auth_token_error_1241");
              }
            )
            .catch(function (err: any) {
              res.status(500);
              console.error(err);
              onDone("polis_err_auth_token_error_5345");
            });
        } else if (isOptional) {
          onDone(); // didn't create user
        } else {
          res.status(401);
          onDone("polis_err_auth_token_not_supplied");
        }
      });
    }
    return function (
      req: any,
      res: { status: (arg0: number) => void },
      next: (arg0?: undefined) => void
    ) {
      doAuth(req, res)
        .then(() => {
          return next();
        })
        .catch((err: any) => {
          res.status(500);
          console.error(err);
          next(err || "polis_err_auth_error_432");
        });
    };
  }
  // input token from body or query, and populate req.body.u with userid.
  function authOptional(assigner: any) {
    return _auth(assigner, true);
  }

  function auth(assigner: any) {
    return _auth(assigner, false);
  }

  function enableAgid(req: { body: Body }, res: any, next: () => void) {
    req.body.agid = 1;
    next();
  }
  // 2xx
  // 4xx
  // 5xx
  // logins
  // failed logins
  // forgot password

  let whitelistedCrossDomainRoutes = [
    /^\/api\/v[0-9]+\/launchPrep/,
    /^\/api\/v[0-9]+\/setFirstCookie/,
  ];

  function addCorsHeader(
    req: {
      protocol: string;
      get: (arg0: string) => any;
      path: any;
      headers: Headers;
    },
    res: { header: (arg0: string, arg1: string | boolean) => void },
    next: (arg0?: string) => any
  ) {
    let host = "";
    if (Config.domainOverride) {
      host = req.protocol + "://" + Config.domainOverride;
    } else {
      // TODO does it make sense for this middleware to look
      // at origin || referer? is Origin for CORS preflight?
      // or for everything?
      // Origin was missing from FF, so added Referer.
      host = req.get("Origin") || req.get("Referer") || "";
    }

    // Somehow the fragment identifier is being sent by IE10????
    // Remove unexpected fragment identifier
    host = host.replace(/#.*$/, "");

    // Remove characters starting with the first slash following the double slash at the beginning.
    let result = /^[^\/]*\/\/[^\/]*/.exec(host);
    if (result && result[0]) {
      host = result[0];
    }
    // check if the route is on a special list that allows it to be called cross domain (by polisHost.js for example)
    let routeIsWhitelistedForAnyDomain = _.some(
      whitelistedCrossDomainRoutes,
      function (regex: { test: (arg0: any) => any }) {
        return regex.test(req.path);
      }
    );

    if (
      !Config.domainOverride &&
      !hasWhitelistMatches(host) &&
      !routeIsWhitelistedForAnyDomain
    ) {
      console.log("info", "not whitelisted");
      console.log("info", req.headers);
      console.log("info", req.path);
      return next("unauthorized domain: " + host);
    }
    if (host === "") {
      // API
    } else {
      res.header("Access-Control-Allow-Origin", host);
      res.header(
        "Access-Control-Allow-Headers",
        "Cache-Control, Pragma, Origin, Authorization, Content-Type, X-Requested-With"
      );
      res.header(
        "Access-Control-Allow-Methods",
        "GET, PUT, POST, DELETE, OPTIONS"
      );
      res.header("Access-Control-Allow-Credentials", true);
    }
    return next();
  }

  let lastPrefetchedMathTick = -1;

  // this scheme might not last forever. For now, there are only a couple of MB worth of conversation pca data.
  function fetchAndCacheLatestPcaData() {
    let lastPrefetchPollStartTime = Date.now();

    function waitTime() {
      let timePassed = Date.now() - lastPrefetchPollStartTime;
      return Math.max(0, 2500 - timePassed);
    }
    // cursor.sort([["math_tick", "asc"]]);
    dbPgQuery
      .queryP_readOnly(
        "select * from math_main where caching_tick > ($1) order by caching_tick limit 10;",
        [lastPrefetchedMathTick]
      )
      // Argument of type '(rows: any[]) => void' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.
      // Types of parameters 'rows' and 'value' are incompatible.
      //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
      // @ts-ignore
      .then((rows: any[]) => {
        if (!rows || !rows.length) {
          // call again
          console.log("mathpoll done");
          setTimeout(fetchAndCacheLatestPcaData, waitTime());
          return;
        }

        let results = rows.map(
          (row: { data: any; math_tick: any; caching_tick: any }) => {
            let item = row.data;

            if (row.math_tick) {
              item.math_tick = Number(row.math_tick);
            }
            if (row.caching_tick) {
              item.caching_tick = Number(row.caching_tick);
            }

            console.log("mathpoll updating", item.caching_tick, item.zid);

            if (item.caching_tick > lastPrefetchedMathTick) {
              lastPrefetchedMathTick = item.caching_tick;
            }

            processMathObject(item);

            return updatePcaCache(item.zid, item);
          }
        );
        Promise.all(results).then((a: any) => {
          setTimeout(fetchAndCacheLatestPcaData, waitTime());
        });
      })
      .catch((err: any) => {
        console.log("mathpoll error", err);
        setTimeout(fetchAndCacheLatestPcaData, waitTime());
      });
  }

  // don't start immediately, let other things load first.
  // setTimeout(fetchAndCacheLatestPcaData, 5000);
  fetchAndCacheLatestPcaData; // TODO_DELETE

  function redirectIfHasZidButNoConversationId(
    req: { body: { zid: any; conversation_id: any } },
    res: {
      writeHead: (arg0: number, arg1: { Location: string }) => void;
      end: () => any;
    },
    next: () => any
  ) {
    if (req.body.zid && !req.body.conversation_id) {
      console.log("info", "redirecting old zid user to about page");
      res.writeHead(302, {
        Location: "https://pol.is/about",
      });
      return res.end();
    }
    return next();
  }

  if (
    process.env.RUN_PERIODIC_EXPORT_TESTS &&
    !devMode &&
    process.env.MATH_ENV === "preprod"
  ) {
    let runExportTest = () => {
      let math_env = "prod";
      let email = adminEmailDataExportTest;
      let zid = 12480;
      let atDate = Date.now();
      let format = "csv";
      let task_bucket = Math.abs((Math.random() * 999999999999) >> 0);
      doAddDataExportTask(
        math_env,
        email,
        zid,
        atDate,
        format,
        task_bucket
      ).then(() => {
        setTimeout(() => {
          dbPgQuery
            .queryP(
              "select * from worker_tasks where task_type = 'generate_export_data' and task_bucket = ($1);",
              [task_bucket]
            )
            //           Argument of type '(rows: string | any[]) => void' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.
            // Types of parameters 'rows' and 'value' are incompatible.
            //   Type 'unknown' is not assignable to type 'string | any[]'.
            //           Type 'unknown' is not assignable to type 'any[]'.ts(2345)
            // @ts-ignore
            .then((rows: string | any[]) => {
              let ok = rows && rows.length;
              let newOk;
              if (ok) {
                newOk = rows[0].finished_time > 0;
              }
              if (ok && newOk) {
                console.log("runExportTest success");
              } else {
                console.log("runExportTest failed");
                emailBadProblemTime("Math export didn't finish.");
              }
            });
        }, 10 * 60 * 1000); // wait 10 minutes before verifying
      });
    };
    setInterval(runExportTest, 6 * 60 * 60 * 1000); // every 6 hours
  }

  function doCookieAuth(
    assigner: (arg0: any, arg1: string, arg2: number) => void,
    isOptional: any,
    req: { cookies: { [x: string]: any }; body: { uid?: any } },
    res: { status: (arg0: number) => void },
    next: { (err: any): void; (arg0?: string): void }
  ) {
    let token = req.cookies[cookies.COOKIES.TOKEN];

    //if (req.body.uid) { next(401); return; } // shouldn't be in the post - TODO - see if we can do the auth in parallel for non-destructive operations
    Session.getUserInfoForSessionToken(
      token,
      res,
      function (err: any, uid?: any) {
        if (err) {
          clearCookies(req, res); // TODO_MULTI_DATACENTER_CONSIDERATION
          if (isOptional) {
            next();
          } else {
            res.status(403);
            next("polis_err_auth_no_such_token");
          }
          return;
        }
        if (req.body.uid && req.body.uid !== uid) {
          res.status(401);
          next("polis_err_auth_mismatch_uid");
          return;
        }
        assigner(req, "uid", Number(uid));
        next();
      }
    );
  }

  function checkZinviteCodeValidity(
    zid: any,
    zinvite: any,
    callback: {
      (err: any, foo: any): void;
      (err: any, foo: any): void;
      (err: any): void;
      (arg0: number | null): void;
    }
  ) {
    dbPgQuery.query_readOnly(
      "SELECT * FROM zinvites WHERE zid = ($1) AND zinvite = ($2);",
      [zid, zinvite],
      function (err: any, results: { rows: string | any[] }) {
        if (err || !results || !results.rows || !results.rows.length) {
          callback(1);
        } else {
          callback(null); // ok
        }
      }
    );
  }

  function checkSuzinviteCodeValidity(
    zid: any,
    suzinvite: any,
    callback: {
      (err: any, foo: any): void;
      (err: any, foo: any): void;
      (err: any): void;
      (arg0: number | null): void;
    }
  ) {
    dbPgQuery.query(
      "SELECT * FROM suzinvites WHERE zid = ($1) AND suzinvite = ($2);",
      [zid, suzinvite],
      function (err: any, results: { rows: string | any[] }) {
        if (err || !results || !results.rows || !results.rows.length) {
          callback(1);
        } else {
          callback(null); // ok
        }
      }
    );
  }

  function trySendingBackupEmailTest() {
    if (devMode) {
      return;
    }
    let d = new Date();
    if (d.getDay() === 1) {
      // send the monday backup email system test
      // If the sending fails, we should get an error ping.
      emailSenders.sendTextEmailWithBackupOnly(
        POLIS_FROM_ADDRESS,
        adminEmailEmailTest,
        "monday backup email system test",
        "seems to be working"
      );
    }
  }
  setInterval(trySendingBackupEmailTest, 1000 * 60 * 60 * 23); // try every 23 hours (so it should only try roughly once a day)
  trySendingBackupEmailTest();

  function isEmailVerified(email: any) {
    return (
      dbPgQuery
        .queryP("select * from email_validations where email = ($1);", [email])
        //     Argument of type '(rows: string | any[]) => boolean' is not assignable to parameter of type '(value: unknown) => boolean | PromiseLike<boolean>'.
        // Types of parameters 'rows' and 'value' are incompatible.
        //   Type 'unknown' is not assignable to type 'string | any[]'.
        //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
        // @ts-ignore
        .then(function (rows: string | any[]) {
          return rows.length > 0;
        })
    );
  }

  function maybeAddNotificationTask(zid: any, timeInMillis: any) {
    return dbPgQuery.queryP(
      "insert into notification_tasks (zid, modified) values ($1, $2) on conflict (zid) do nothing;",
      [zid, timeInMillis]
    );
  }

  function claimNextNotificationTask() {
    return (
      dbPgQuery
        .queryP(
          "delete from notification_tasks where zid = (select zid from notification_tasks order by random() for update skip locked limit 1) returning *;"
        )
        //   Argument of type '(rows: string | any[]) => any' is not assignable to parameter of type '(value: unknown) => any'.
        // Types of parameters 'rows' and 'value' are incompatible.
        //   Type 'unknown' is not assignable to type 'string | any[]'.
        //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
        // @ts-ignore
        .then((rows: string | any[]) => {
          if (!rows || !rows.length) {
            return null;
          }
          return rows[0];
        })
    );
  }

  function getDbTime() {
    return dbPgQuery.queryP("select now_as_millis();", []).then(
      //     Argument of type '(rows: {    now_as_millis: any;}[]) => any' is not assignable to parameter of type '(value: unknown) => any'.
      // Types of parameters 'rows' and 'value' are incompatible.
      //   Type 'unknown' is not assignable to type '{ now_as_millis: any; }[]'.ts(2345)
      // @ts-ignore
      (rows: { now_as_millis: any }[]) => {
        return rows[0].now_as_millis;
      }
    );
  }

  function doNotificationsForZid(zid: any, timeOfLastEvent: any) {
    let shouldTryAgain = false;

    return (
      dbPgQuery
        .queryP(
          "select * from participants where zid = ($1) and last_notified < ($2) and subscribed > 0;",
          [zid, timeOfLastEvent]
        )
        // Argument of type '(candidates: any[]) => Promise<{ pid: string | number; remaining: any; }[]
        // | null > | null' is not assignable to parameter of type '(value: unknown) => { pid: string | number; remaining: any; } []
        // | PromiseLike<{ pid: string | number; remaining: any; }[] | null> | null'.
        // Types of parameters 'candidates' and 'value' are incompatible.
        //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
        // @ts-ignore
        .then((candidates: any[]) => {
          if (!candidates || !candidates.length) {
            return null;
          }
          candidates = candidates.map(
            (ptpt: { last_notified: number; last_interaction: number }) => {
              ptpt.last_notified = Number(ptpt.last_notified);
              ptpt.last_interaction = Number(ptpt.last_interaction);
              return ptpt;
            }
          );
          return Promise.all([
            getDbTime(),
            Conversation.getConversationInfo(zid),
            getZinvite(zid),
          ]).then((a: any[]) => {
            let dbTimeMillis = a[0];
            let conv = a[1];
            let conversation_id = a[2];

            let url = conv.parent_url || "https://pol.is/" + conversation_id;

            let pid_to_ptpt = {};
            candidates.forEach((c: { pid: string | number }) => {
              // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
              // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
              // @ts-ignore
              pid_to_ptpt[c.pid] = c;
            });
            return Promise.mapSeries(
              candidates,
              (item: { zid: any; pid: any }, index: any, length: any) => {
                return Comment.getNumberOfCommentsRemaining(
                  item.zid,
                  item.pid
                ).then(
                  // Argument of type '(rows: any[]) => any' is not assignable to parameter of type '(value: unknown) => any'.
                  // Types of parameters 'rows' and 'value' are incompatible.
                  //  Type 'unknown' is not assignable to type 'any[]'.ts(2345)
                  // @ts-ignore
                  (rows: any[]) => {
                    return rows[0];
                  }
                );
              }
            ).then((results: any[]) => {
              const needNotification = results.filter(
                (result: { pid: string | number; remaining: number }) => {
                  // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
                  // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
                  // @ts-ignore
                  let ptpt = pid_to_ptpt[result.pid];
                  let needs = true;

                  needs = needs && result.remaining > 0;

                  // if (needs && result.remaining < 5) {
                  //   // no need to try again for this user since new comments will create new tasks
                  //   console.log('doNotificationsForZid', 'not enough remaining');
                  //   needs = false;
                  // }

                  let waitTime = 60 * 60 * 1000;

                  // notifications since last interation
                  if (ptpt.nsli === 0) {
                    // first notification since last interaction
                    waitTime = 60 * 60 * 1000; // 1 hour
                  } else if (ptpt.nsli === 1) {
                    // second notification since last interaction
                    waitTime = 2 * 60 * 60 * 1000; // 4 hours
                  } else if (ptpt.nsli === 2) {
                    // third notification since last interaction
                    waitTime = 24 * 60 * 60 * 1000; // 24 hours
                  } else if (ptpt.nsli === 3) {
                    // third notification since last interaction
                    waitTime = 48 * 60 * 60 * 1000; // 48 hours
                  } else {
                    // give up, if they vote again nsli will be set to zero again.
                    console.log("doNotificationsForZid", "nsli");
                    needs = false;
                  }

                  if (needs && dbTimeMillis < ptpt.last_notified + waitTime) {
                    // Limit to one per hour.
                    console.log(
                      "doNotificationsForZid",
                      "shouldTryAgain",
                      "last_notified"
                    );
                    shouldTryAgain = true;
                    needs = false;
                  }
                  if (
                    needs &&
                    dbTimeMillis < ptpt.last_interaction + 5 * 60 * 1000
                  ) {
                    // Wait until 5 minutes after their last interaction.
                    console.log(
                      "doNotificationsForZid",
                      "shouldTryAgain",
                      "last_interaction"
                    );
                    shouldTryAgain = true;
                    needs = false;
                  }

                  if (devMode) {
                    needs = needs && isPolisDev(ptpt.uid);
                  }
                  return needs;
                }
              );

              if (needNotification.length === 0) {
                return null;
              }
              const pids = _.pluck(needNotification, "pid");

              // return dbPgQuery.queryP("select p.uid, p.pid, u.email from participants as p left join users as u on p.uid = u.uid where p.pid in (" + pids.join(",") + ")", []).then((rows) => {

              // })
              return (
                dbPgQuery
                  .queryP(
                    "select uid, subscribe_email from participants_extended where uid in (select uid from participants where pid in (" +
                      pids.join(",") +
                      "));",
                    []
                  )
                  // Argument of type '(rows: any[]) => Promise<{ pid: string | number; remaining: any; }[]>'
                  // is not assignable to parameter of type '(value: unknown) => { pid: string | number; remaining: any; }[]
                  // | PromiseLike < { pid: string | number; remaining: any; }[] > '.
                  // Types of parameters 'rows' and 'value' are incompatible.
                  //   Type 'unknown' is not assignable to type 'any[]'.ts(2345)
                  // @ts-ignore
                  .then((rows: any[]) => {
                    let uidToEmail = {};
                    rows.forEach(
                      (row: { uid: string | number; subscribe_email: any }) => {
                        // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
                        // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
                        // @ts-ignore
                        uidToEmail[row.uid] = row.subscribe_email;
                      }
                    );

                    return Promise.each(
                      needNotification,
                      (
                        item: { pid: string | number; remaining: any },
                        index: any,
                        length: any
                      ) => {
                        // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
                        // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
                        // @ts-ignore
                        const uid = pid_to_ptpt[item.pid].uid;
                        return sendNotificationEmail(
                          uid,
                          url,
                          conversation_id,
                          // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
                          // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
                          // @ts-ignore
                          uidToEmail[uid],
                          item.remaining
                        ).then(() => {
                          return dbPgQuery.queryP(
                            "update participants set last_notified = now_as_millis(), nsli = nsli + 1 where uid = ($1) and zid = ($2);",
                            [uid, zid]
                          );
                        });
                      }
                    );
                  })
              );
            });
          });
        })
        .then(() => {
          return shouldTryAgain;
        })
    );
  }
  function doNotificationBatch() {
    return claimNextNotificationTask().then(
      (task: { zid: any; modified: any }) => {
        if (!task) {
          return Promise.resolve();
        }
        console.log("doNotificationsForZid", task.zid);
        return doNotificationsForZid(task.zid, task.modified).then(
          (shouldTryAgain: any) => {
            console.log(
              "doNotificationsForZid",
              task.zid,
              "shouldTryAgain",
              shouldTryAgain
            );
            if (shouldTryAgain) {
              // Since we claimed the task above, there will be no record, so we need to
              // put it back to trigger a retry - unless there's a new one there, in which case we should
              // leave the new one.
              maybeAddNotificationTask(task.zid, task.modified);
            }
          }
        );
      }
    );
  }

  function doNotificationLoop() {
    console.log("doNotificationLoop");
    doNotificationBatch().then(() => {
      setTimeout(doNotificationLoop, 10000);
    });
  }

  function sendNotificationEmail(
    uid?: any,
    url?: string,
    conversation_id?: string,
    email?: any,
    remaining?: any
  ) {
    let subject =
      "New statements to vote on (conversation " + conversation_id + ")"; // Not sure if putting the conversation_id is ideal, but we need some way to ensure that the notifications for each conversation appear in separte threads.
    let body = "There are new statements available for you to vote on here:\n";
    body += "\n";
    body += url + "\n";
    body += "\n";
    body +=
      "You're receiving this message because you're signed up to receive Polis notifications for this conversation. You can unsubscribe from these emails by clicking this link:\n";
    body += createNotificationsUnsubscribeUrl(conversation_id, email) + "\n";
    body += "\n";
    body +=
      "If for some reason the above link does not work, please reply directly to this email with the message 'Unsubscribe' and we will remove you within 24 hours.";
    body += "\n";
    body += "Thanks for your participation";
    return sendEmailByUid(uid, subject, body);
  }

  let shouldSendNotifications = !devMode;
  // let shouldSendNotifications = true;
  // let shouldSendNotifications = false;
  if (shouldSendNotifications) {
    doNotificationLoop();
  }

  function isParentDomainWhitelisted(
    domain: string,
    zid: any,
    isWithinIframe: any,
    domain_whitelist_override_key: any
  ) {
    return (
      dbPgQuery
        .queryP_readOnly(
          "select * from site_domain_whitelist where site_id = " +
            "(select site_id from users where uid = " +
            "(select owner from conversations where zid = ($1)));",
          [zid]
        )
        //     Argument of type '(rows: string | any[]) => boolean' is not assignable to parameter of type '(value: unknown) => boolean | PromiseLike<boolean>'.
        // Types of parameters 'rows' and 'value' are incompatible.
        //   Type 'unknown' is not assignable to type 'string | any[]'.
        //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
        // @ts-ignore
        .then(function (rows: string | any[]) {
          console.log("isParentDomainWhitelisted", domain, zid, isWithinIframe);
          if (!rows || !rows.length || !rows[0].domain_whitelist.length) {
            // there is no whitelist, so any domain is ok.
            console.log("isParentDomainWhitelisted", "no whitelist");
            return true;
          }
          let whitelist = rows[0].domain_whitelist;
          let wdomains = whitelist.split(",");
          if (!isWithinIframe && wdomains.indexOf("*.pol.is") >= 0) {
            // if pol.is is in the whitelist, then it's ok to show the conversation outside of an iframe.
            console.log("isParentDomainWhitelisted", "*.pol.is");
            return true;
          }
          if (
            domain_whitelist_override_key &&
            rows[0].domain_whitelist_override_key ===
              domain_whitelist_override_key
          ) {
            return true;
          }
          let ok = false;
          console.log("isParentDomainWhitelisted", 1);
          for (var i = 0; i < wdomains.length; i++) {
            let w = wdomains[i];
            let wParts = w.split(".");

            // example: domain might be blogs.nytimes.com, and whitelist entry might be *.nytimes.com, and that should be a match
            let parts = domain.split(".");

            console.log("isParentDomainWhitelisted", 2, wParts, parts);
            if (wParts.length && wParts[0] === "*") {
              // wild card case
              // check for a match on each part following the '*'
              let bad = false;

              wParts = wParts.reverse();
              parts = parts.reverse();
              console.log("isParentDomainWhitelisted", 3, parts, wParts);
              for (var p = 0; p < wParts.length - 1; p++) {
                console.log(
                  "isParentDomainWhitelisted",
                  33,
                  parts[p],
                  wParts[p]
                );
                if (wParts[p] !== parts[p]) {
                  bad = true;
                  console.log("isParentDomainWhitelisted", 4);
                  break;
                }
              }
              ok = !bad;
            } else {
              // no wild card
              let bad2 = false;
              console.log("isParentDomainWhitelisted", 5);
              if (wParts.length !== parts.length) {
                console.log("isParentDomainWhitelisted", 6);
                bad2 = true;
              }
              console.log("isParentDomainWhitelisted", 61, parts, wParts);
              // check for a match on each part
              for (var p2 = 0; p2 < wParts.length; p2++) {
                console.log(
                  "isParentDomainWhitelisted",
                  66,
                  parts[p2],
                  wParts[p2]
                );
                if (wParts[p2] !== parts[p2]) {
                  bad2 = true;
                  console.log("isParentDomainWhitelisted", 7);
                  break;
                }
              }
              ok = !bad2;
            }

            if (ok) {
              break;
            }
          }
          console.log("isParentDomainWhitelisted", 8, ok);
          return ok;
        })
    );
  }
  function denyIfNotFromWhitelistedDomain(
    req: {
      headers?: { referrer: string };
      p: { zid: any; domain_whitelist_override_key: any };
    },
    res: { send: (arg0: number, arg1: string) => void },
    next: (arg0?: string) => void
  ) {
    let isWithinIframe =
      req.headers &&
      req.headers.referrer &&
      req.headers.referrer.includes("parent_url");

    let ref = req?.headers?.referrer;
    let refParts: string[] = [];
    let resultRef = "";
    if (isWithinIframe) {
      if (ref) {
        const decodedRefString = decodeURIComponent(
          ref.replace(/.*parent_url=/, "").replace(/&.*/, "")
        );
        if (decodedRefString && decodedRefString.length)
          refParts = decodedRefString.split("/");
        resultRef = (refParts && refParts.length >= 3 && refParts[2]) || "";
      }
    } else {
      if (ref && ref.length) refParts = ref.split("/");
      if (refParts && refParts.length >= 3) resultRef = refParts[2] || "";
    }
    let zid = req.p.zid;

    isParentDomainWhitelisted(
      resultRef,
      zid,
      isWithinIframe,
      req.p.domain_whitelist_override_key
    )
      .then(function (isOk: any) {
        if (isOk) {
          next();
        } else {
          res.send(403, "polis_err_domain");
          next("polis_err_domain");
        }
      })
      .catch(function (err: any) {
        console.error(err);
        res.send(403, "polis_err_domain");
        next("polis_err_domain_misc");
      });
  }

  function getTwitterUserInfoBulk(list_of_twitter_user_id: any[]) {
    list_of_twitter_user_id = list_of_twitter_user_id || [];
    let oauth = new OAuth.OAuth(
      "https://api.twitter.com/oauth/request_token", // null
      "https://api.twitter.com/oauth/access_token", // null
      // Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
      // Type 'undefined' is not assignable to type 'string'.ts(2345)
      // @ts-ignore
      process.env.TWITTER_CONSUMER_KEY, //'your application consumer key',
      process.env.TWITTER_CONSUMER_SECRET, //'your application secret',
      "1.0A",
      null,
      "HMAC-SHA1"
    );
    return new Promise(function (
      resolve: (arg0: any) => void,
      reject: (arg0: any) => void
    ) {
      oauth.post(
        "https://api.twitter.com/1.1/users/lookup.json",
        // Argument of type 'undefined' is not assignable to parameter of type 'string'.ts(2345)
        // @ts-ignore
        void 0, //'your user token for this app', //test user token
        void 0, //'your user secret for this app', //test user secret
        {
          // oauth_verifier: req.p.oauth_verifier,
          // oauth_token: req.p.oauth_token, // confused. needed, but docs say this: "The request token is also passed in the oauth_token portion of the header, but this will have been added by the signing process."
          user_id: list_of_twitter_user_id.join(","),
        },
        "multipart/form-data",
        function (e: any, data: string, res: any) {
          if (e) {
            console.error("get twitter token failed");
            console.error(e);
            // we should probably check that the error is code 17:  { statusCode: 404, data: '{"errors":[{"code":17,"message":"No user matches for specified terms."}]}' }
            list_of_twitter_user_id.forEach(function (id: string) {
              console.log(
                "adding twitter_user_id to suspendedOrPotentiallyProblematicTwitterIds: " +
                  id
              );
              suspendedOrPotentiallyProblematicTwitterIds.push(id);
            });
            reject(e);
          } else {
            data = JSON.parse(data);
            resolve(data);
          }
        }
      );
    });
  }

  function updateSomeTwitterUsers() {
    return (
      dbPgQuery
        .queryP_readOnly(
          "select uid, twitter_user_id from twitter_users where modified < (now_as_millis() - 30*60*1000) order by modified desc limit 100;"
        )
        //     Argument of type '(results: string | any[]) => never[] | undefined' is not assignable to parameter of type '(value: unknown) => never[] | PromiseLike<never[] | undefined> | undefined'.
        // Types of parameters 'results' and 'value' are incompatible.
        //   Type 'unknown' is not assignable to type 'string | any[]'.
        //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
        // @ts-ignore
        .then(function (results: string | any[]) {
          let twitter_user_ids = _.pluck(results, "twitter_user_id");
          if (results.length === 0) {
            return [];
          }
          twitter_user_ids = _.difference(
            twitter_user_ids,
            suspendedOrPotentiallyProblematicTwitterIds
          );
          if (twitter_user_ids.length === 0) {
            return [];
          }

          getTwitterUserInfoBulk(twitter_user_ids)
            .then(function (info: any[]) {
              let updateQueries = info.map(function (u: {
                id: any;
                screen_name: any;
                name: any;
                followers_count: any;
                friends_count: any;
                verified: any;
                profile_image_url_https: any;
                location: any;
              }) {
                let q =
                  "update twitter_users set " +
                  "screen_name = ($2)," +
                  "name = ($3)," +
                  "followers_count = ($4)," +
                  "friends_count = ($5)," +
                  "verified = ($6)," +
                  "profile_image_url_https = ($7)," +
                  "location = ($8)," +
                  "modified = now_as_millis() " +
                  "where twitter_user_id = ($1);";

                // uncomment to see some other twitter crap
                //console.log(q);
                return dbPgQuery.queryP(q, [
                  u.id,
                  u.screen_name,
                  u.name,
                  u.followers_count,
                  u.friends_count,
                  u.verified,
                  u.profile_image_url_https,
                  u.location,
                ]);
              });
              return Promise.all(updateQueries).then(function () {
                console.log("done123");
              });
            })
            .catch(function (err: any) {
              console.error(
                "error updating twitter users:" + twitter_user_ids.join(" ")
              );
            });
        })
    );
  }
  // Ensure we don't call this more than 60 times in each 15 minute window (across all of our servers/use-cases)
  setInterval(updateSomeTwitterUsers, 1 * 60 * 1000);
  updateSomeTwitterUsers();

  // Value of type 'typeof LRUCache' is not callable. Did you mean to include 'new'? ts(2348)
  // @ts-ignore
  let twitterShareCountCache = LruCache({
    maxAge: 1000 * 60 * 30, // 30 minutes
    max: 999,
  });

  function getTwitterShareCountForConversation(conversation_id: string) {
    let cached = twitterShareCountCache.get(conversation_id);
    if (cached) {
      return Promise.resolve(cached);
    }
    let httpUrl =
      "https://cdn.api.twitter.com/1/urls/count.json?url=http://pol.is/" +
      conversation_id;
    let httpsUrl =
      "https://cdn.api.twitter.com/1/urls/count.json?url=https://pol.is/" +
      conversation_id;
    return Promise.all([request.get(httpUrl), request.get(httpsUrl)]).then(
      function (a: any[]) {
        let httpResult = a[0];
        let httpsResult = a[1];
        let httpCount = JSON.parse(httpResult).count;
        let httpsCount = JSON.parse(httpsResult).count;
        if (httpCount > 0 && httpsCount > 0 && httpCount === httpsCount) {
          console.warn(
            "found matching http and https twitter share counts, if this is common, check twitter api to see if it has changed."
          );
        }
        let count = httpCount + httpsCount;
        twitterShareCountCache.set(conversation_id, count);
        return count;
      }
    );
  }

  // Value of type 'typeof LRUCache' is not callable. Did you mean to include 'new'? ts(2348)
  // @ts-ignore
  let fbShareCountCache = LruCache({
    maxAge: 1000 * 60 * 30, // 30 minutes
    max: 999,
  });

  function getFacebookShareCountForConversation(conversation_id: string) {
    let cached = fbShareCountCache.get(conversation_id);
    if (cached) {
      return Promise.resolve(cached);
    }
    let url = "http://graph.facebook.com/?id=https://pol.is/" + conversation_id;
    return request.get(url).then(function (result: string) {
      let shares = JSON.parse(result).shares;
      fbShareCountCache.set(conversation_id, shares);
      return shares;
    });
  }

  function makeRedirectorTo(path: string) {
    return function (
      req: { headers?: { host: string } },
      res: {
        writeHead: (arg0: number, arg1: { Location: string }) => void;
        end: () => void;
      }
    ) {
      let protocol = devMode ? "http://" : "https://";
      let url = protocol + req?.headers?.host + path;
      res.writeHead(302, {
        Location: url,
      });
      res.end();
    };
  }

  // https://github.com/mindmup/3rdpartycookiecheck/
  // https://stackoverflow.com/questions/32601424/render-raw-html-in-response-with-express
  function fetchThirdPartyCookieTestPt1(
    req: any,
    res: {
      set: (arg0: { "Content-Type": string }) => void;
      send: (arg0: Buffer) => void;
    }
  ) {
    res.set({ "Content-Type": "text/html" });
    res.send(
      new Buffer(
        "<body>\n" +
          "<script>\n" +
          '  document.cookie="thirdparty=yes; Max-Age=3600; SameSite=None; Secure";\n' +
          '  document.location="thirdPartyCookieTestPt2.html";\n' +
          "</script>\n" +
          "</body>"
      )
    );
  }
  function fetchThirdPartyCookieTestPt2(
    req: any,
    res: {
      set: (arg0: { "Content-Type": string }) => void;
      send: (arg0: Buffer) => void;
    }
  ) {
    res.set({ "Content-Type": "text/html" });
    res.send(
      new Buffer(
        "<body>\n" +
          "<script>\n" +
          "  if (window.parent) {\n" +
          "   if (/thirdparty=yes/.test(document.cookie)) {\n" +
          "     window.parent.postMessage('MM:3PCsupported', '*');\n" +
          "   } else {\n" +
          "     window.parent.postMessage('MM:3PCunsupported', '*');\n" +
          "   }\n" +
          "   document.cookie = 'thirdparty=; expires=Thu, 01 Jan 1970 00:00:01 GMT;';\n" +
          "  }\n" +
          "</script>\n" +
          "</body>"
      )
    );
  }

  function isUnsupportedBrowser(req: { headers?: { [x: string]: string } }) {
    return /MSIE [234567]/.test(req?.headers?.["user-agent"] || "");
  }

  let fetchUnsupportedBrowserPage = makeFileFetcher(
    hostname,
    portForParticipationFiles,
    "/unsupportedBrowser.html",
    {
      "Content-Type": "text/html",
    }
  );

  function fetchIndex(
    req: { path: string; headers?: { host: string } },
    res: {
      writeHead: (arg0: number, arg1: { Location: string }) => void;
      end: () => any;
    },
    preloadData: { conversation?: ConversationType },
    port: string | undefined,
    buildNumber?: string | null | undefined
  ) {
    let headers = {
      "Content-Type": "text/html",
    };
    if (!devMode) {
      Object.assign(headers, {
        // 'Cache-Control': 'no-transform,public,max-age=60,s-maxage=60', // Cloudflare will probably cache it for one or two hours
        "Cache-Control": "no-cache", // Cloudflare will probably cache it for one or two hours
      });
    }

    // Argument of type '{ path: string; headers?: { host: string; } | undefined; }' is not assignable to parameter of type 'Req'.
    //  Property 'cookies' is missing in type '{ path: string; headers?: { host: string; } | undefined; }' but required in type 'Req'.ts(2345)
    cookies.setCookieTestCookie(
      req,
      res,
      // @ts-ignore
      cookies.shouldSetCookieOnPolisDomain(req)
    );

    if (devMode) {
      buildNumber = null;
    }

    let indexPath =
      (buildNumber ? "/cached/" + buildNumber : "") + "/index.html";

    let doFetch = makeFileFetcher(
      hostname,
      port,
      indexPath,
      headers,
      preloadData
    );
    if (isUnsupportedBrowser(req)) {
      // Argument of type '{ path: string; headers?: { host: string; } | undefined; }' is not assignable to parameter of type '{ headers?: { host: any; } | undefined; path: any; pipe: (arg0: any) => void; }'.
      //   Property 'pipe' is missing in type '{ path: string; headers?: { host: string; } | undefined; }' but required in type '{ headers?: { host: any; } | undefined; path: any; pipe: (arg0: any) => void; }'.ts(2345)
      // @ts-ignore
      return fetchUnsupportedBrowserPage(req, res);
    } else if (
      !browserSupportsPushState(req) &&
      req.path.length > 1 &&
      !/^\/api/.exec(req.path) // TODO probably better to create a list of client-side route regexes (whitelist), rather than trying to blacklist things like API calls.
    ) {
      // Redirect to the same URL with the path behind the fragment "#"
      res.writeHead(302, {
        Location: "https://" + req?.headers?.host + "/#" + req.path,
      });

      return res.end();
    } else {
      // Argument of type '{ path: string; headers?: { host: string; } | undefined; }'
      // is not assignable to parameter of type '{ headers?: { host: any; } | undefined;
      // path: any; pipe: (arg0: any) => void; } '.ts(2345)
      // @ts-ignore
      return doFetch(req, res);
    }
  }

  function fetchIndexWithoutPreloadData(req: any, res: any, port: any) {
    return fetchIndex(req, res, {}, port);
  }

  let fetch404Page = makeFileFetcher(hostname, portForAdminFiles, "/404.html", {
    "Content-Type": "text/html",
  });

  function fetchIndexForConversation(
    req: { path: string; query?: { build: any } },
    res: any
  ) {
    console.log("fetchIndexForConversation", req.path);
    let match = req.path.match(/[0-9][0-9A-Za-z]+/);
    let conversation_id: any;
    if (match && match.length) {
      conversation_id = match[0];
    }
    let buildNumber: null = null;
    if (req?.query?.build) {
      buildNumber = req.query.build;
      console.log("loading_build", buildNumber);
    }

    setTimeout(function () {
      // Kick off requests to twitter and FB to get the share counts.
      // This will be nice because we cache them so it will be fast when
      // client requests these later.
      // TODO actually store these values in a cache that is shared between
      // the servers, probably just in the db.
      getTwitterShareCountForConversation(conversation_id).catch(function (
        err: string
      ) {
        console.log(
          "fetchIndexForConversation/getTwitterShareCountForConversation err " +
            err
        );
      });
      getFacebookShareCountForConversation(conversation_id).catch(function (
        err: string
      ) {
        console.log(
          "fetchIndexForConversation/getFacebookShareCountForConversation err " +
            err
        );
      });
    }, 100);

    doGetConversationPreloadInfo(conversation_id)
      .then(function (x: any) {
        let preloadData = {
          conversation: x,
          // Nothing user-specific can go here, since we want to cache these per-conv index files on the CDN.
        };
        fetchIndex(
          req,
          res,
          preloadData,
          portForParticipationFiles,
          buildNumber
        );
      })
      .catch(function (err: any) {
        // Argument of type '{ path: string; query?: { build: any; } | undefined; }' is not assignable to parameter of type '{ headers?: { host: any; } | undefined; path: any; pipe: (arg0: any) => void; }'.
        //   Property 'pipe' is missing in type '{ path: string; query?: { build: any; } | undefined; }' but required in type '{ headers?: { host: any; } | undefined; path: any; pipe: (arg0: any) => void; }'.ts(2345)
        console.error(err);
        // @ts-ignore
        fetch404Page(req, res);
        // Log.fail(res, 500, "polis_err_fetching_conversation_info2", err);
      });
  }

  function middleware_log_request_body(
    req: { body: any; path: string },
    res: any,
    next: () => void
  ) {
    if (devMode) {
      let b = "";
      if (req.body) {
        let temp = _.clone(req.body);
        // if (temp.email) {
        //     temp.email = "foo@foo.com";
        // }
        if (temp.password) {
          temp.password = "some_password";
        }
        if (temp.newPassword) {
          temp.newPassword = "some_password";
        }
        if (temp.password2) {
          temp.password2 = "some_password";
        }
        if (temp.hname) {
          temp.hname = "somebody";
        }
        if (temp.polisApiKey) {
          temp.polisApiKey = "pkey_somePolisApiKey";
        }
        b = JSON.stringify(temp);
      }
      console.log("info", req.path + " " + b);
    } else {
      // don't log the route or params, since Heroku does that for us.
    }
    next();
  }

  function middleware_log_middleware_errors(
    err: { stack: any },
    req: any,
    res: any,
    next: (arg0?: { stack: any }) => void
  ) {
    if (!err) {
      return next();
    }
    console.log("info", "error found in middleware");
    console.error(err);
    if (err && err.stack) {
      console.error(err.stack);
    }
    Log.yell(err);
    next(err);
  }

  function middleware_check_if_options(
    req: { method: string },
    res: { send: (arg0: number) => any },
    next: () => any
  ) {
    if (req.method.toLowerCase() !== "options") {
      return next();
    }
    return res.send(204);
  }

  let middleware_responseTime_start = responseTime(function (
    req: { route: { path: any } },
    res: any,
    time: number
  ) {
    if (req && req.route && req.route.path) {
      let path = req.route.path;
      time = Math.trunc(time);
      addInRamMetric(path, time);
    }
  });
  console.log("end initializePolisHelpers");

  const yell = Log.yell;
  const fail = Log.fail;
  const sendTextEmail = emailSenders.sendTextEmail;
  const winston = console;
  const pidCache = User.pidCache;
  const getPidForParticipant = User.getPidForParticipant;

  const returnObject: any = {
    addCorsHeader,
    auth,
    authOptional,
    COOKIES,
    denyIfNotFromWhitelistedDomain,
    devMode,
    emailTeam,
    enableAgid,
    fail,
    fetchThirdPartyCookieTestPt1,
    fetchThirdPartyCookieTestPt2,
    fetchIndexForConversation,
    fetchIndexForAdminPage,
    fetchIndexForReportPage,
    fetchIndexWithoutPreloadData,
    getPidForParticipant,
    haltOnTimeout,
    HMAC_SIGNATURE_PARAM_NAME,
    hostname,
    makeFileFetcher,
    makeRedirectorTo,
    pidCache,
    portForAdminFiles,
    portForParticipationFiles,
    proxy,
    redirectIfApiDomain,
    redirectIfHasZidButNoConversationId,
    redirectIfNotHttps,
    redirectIfWrongDomain,
    sendTextEmail,
    timeout,
    winston,
    writeDefaultHead,
    yell,
    middleware_check_if_options,
    middleware_log_middleware_errors,
    middleware_log_request_body,
    middleware_responseTime_start,
    // handlers
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
    handle_POST_comments,
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
  return returnObject;
} // End of initializePolisHelpers

export { initializePolisHelpers };

export default { initializePolisHelpers };
