"use strict";

import akismetLib from "akismet";
import async from "async";
import badwords from "badwords/object";
import crypto from "crypto";
import Promise from "bluebird";
import httpProxy from "http-proxy";
// @ts-ignore
import FB from "fb";
import isTrue from "boolean";
import OAuth from "oauth";
import replaceStream from "replacestream";
import request from "request-promise"; // includes Request, but adds promise methods
import LruCache from "lru-cache";
import _ from "underscore";
import zlib from "zlib";
import { WebClient } from "@slack/client";

import { addInRamMetric, MPromise } from "./utils/metered";
import CreateUser from "./auth/create-user";
import Password from "./auth/password";
import dbPgQuery from "./db/pg-query";
import { checkPassword } from "./auth/password";
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

import {
  Headers,
  ParticipantInfo,
  UserType,
  ConversationType,
  CommentType,
  TwitterParameters,
  ParticipantSocialNetworkInfo,
  ParticipantOption,
  Demo,
  Assignment,
} from "./d";

const admin_emails = process.env.ADMIN_EMAILS
  ? JSON.parse(process.env.ADMIN_EMAILS)
  : [];

// TODO expire this stuff
let twitterUserInfoCache = new LruCache({
  max: 10000,
});

// zid_pid => "math_tick:ppaddddaadadaduuuuuuuuuuuuuuuuu"; // not using objects to save some ram
// TODO consider "p2a24a2dadadu15" format
let votesForZidPidCache = new LruCache({
  max: 5000,
});

var web = new WebClient(process.env.SLACK_API_TOKEN);

const resolveWith = (x: { body?: { user_id: string } }) => {
  return Promise.resolve(x);
};

const polisDevs = process.env.ADMIN_UIDS
  ? JSON.parse(process.env.ADMIN_UIDS)
  : [];
function isPolisDev(uid?: any) {
  console.log("polisDevs", polisDevs);
  return polisDevs.indexOf(uid) >= 0;
}

const POLIS_FROM_ADDRESS = process.env.POLIS_FROM_ADDRESS;
const devMode = isTrue(process.env.DEV_MODE);

let HMAC_SIGNATURE_PARAM_NAME = "signature";

let LOCATION_SOURCES = {
  Twitter: 400,
  Facebook: 300,
  HTML5: 200,
  IP: 100,
  manual_entry: 1,
};

let whitelistedDomains = [
  "pol.is",
  process.env.DOMAIN_WHITELIST_ITEM_01,
  process.env.DOMAIN_WHITELIST_ITEM_02,
  process.env.DOMAIN_WHITELIST_ITEM_03,
  process.env.DOMAIN_WHITELIST_ITEM_04,
  process.env.DOMAIN_WHITELIST_ITEM_05,
  process.env.DOMAIN_WHITELIST_ITEM_06,
  process.env.DOMAIN_WHITELIST_ITEM_07,
  process.env.DOMAIN_WHITELIST_ITEM_08,
  "localhost:5001",
  "localhost:5002",
  "canvas.instructure.com", // LTI
  "canvas.uw.edu", // LTI
  "canvas.shoreline.edu", // LTI
  "shoreline.instructure.com", // LTI
  "facebook.com",
  "api.twitter.com",
  "", // for API
];

let whitelistedBuckets = {
  "pol.is": "pol.is",
  "embed.pol.is": "pol.is",
  "survey.pol.is": "survey.pol.is",
  "preprod.pol.is": "preprod.pol.is",
};

// Certain twitter ids may be suspended.
// Twitter will error if we request info on them.
//  so keep a list of these for as long as the server is running,
//  so we don't repeat requests for them.
// This is probably not optimal, but is pretty easy.
let suspendedOrPotentiallyProblematicTwitterIds: any[] = [];

let socialParticipantsCache = new LruCache({
  maxAge: 1000 * 30, // 30 seconds
  max: 999,
});

const akismet = akismetLib.client({
  blog: process.env.PRIMARY_POLIS_URL, // required: your root level url
  apiKey: process.env.AKISMET_ANTISPAM_API_KEY,
});

akismet.verifyKey(function (err: any, verified: any) {
  if (verified) {
    console.log("info", "Akismet: API key successfully verified.");
  } else {
    console.log("info", "Akismet: Unable to verify API key.");
  }
});

// serve up index.html in response to anything starting with a number
let hostname = process.env.STATIC_FILES_HOST;
let portForParticipationFiles = process.env.STATIC_FILES_PORT;

let portForAdminFiles = process.env.STATIC_FILES_ADMINDASH_PORT;
let fetchIndexForAdminPage = makeFileFetcher(
  hostname,
  portForAdminFiles,
  "/index_admin.html",
  {
    "Content-Type": "text/html",
  }
);
let fetchIndexForReportPage = makeFileFetcher(
  hostname,
  portForAdminFiles,
  "/index_report.html",
  {
    "Content-Type": "text/html",
  }
);

let zidToConversationIdCache = new LruCache({
  max: 1000,
});

let pcaCacheSize = process.env.CACHE_MATH_RESULTS === "true" ? 300 : 1;
let pcaCache = new LruCache({
  max: pcaCacheSize,
});

function createProdModerationUrl(zinvite: string) {
  return "https://pol.is/m/" + zinvite;
}

function processMathObject(o: { [x: string]: any }) {
  function remapSubgroupStuff(g: { val: any[] }) {
    if (_.isArray(g.val)) {
      g.val = g.val.map((x: { id: number }) => {
        return { id: Number(x.id), val: x };
      });
    } else {
      // Argument of type '(id: number) => { id: number; val: any; }'
      // is not assignable to parameter of type '(value: string, index: number, array: string[]) => { id: number; val: any; }'.
      // Types of parameters 'id' and 'value' are incompatible.
      //         Type 'string' is not assignable to type 'number'.ts(2345)
      // @ts-ignore
      g.val = _.keys(g.val).map((id: number) => {
        return { id: Number(id), val: g.val[id] };
      });
    }
    return g;
  }

  // Normalize so everything is arrays of objects (group-clusters is already in this format, but needs to have the val: subobject style too).

  if (_.isArray(o["group-clusters"])) {
    // NOTE this is different since group-clusters is already an array.
    o["group-clusters"] = o["group-clusters"].map((g: { id: any }) => {
      return { id: Number(g.id), val: g };
    });
  }

  if (!_.isArray(o["repness"])) {
    o["repness"] = _.keys(o["repness"]).map((gid: string | number) => {
      return { id: Number(gid), val: o["repness"][gid] };
    });
  }
  if (!_.isArray(o["group-votes"])) {
    o["group-votes"] = _.keys(o["group-votes"]).map((gid: string | number) => {
      return { id: Number(gid), val: o["group-votes"][gid] };
    });
  }
  if (!_.isArray(o["subgroup-repness"])) {
    o["subgroup-repness"] = _.keys(o["subgroup-repness"]).map(
      (gid: string | number) => {
        return { id: Number(gid), val: o["subgroup-repness"][gid] };
      }
    );
    o["subgroup-repness"].map(remapSubgroupStuff);
  }
  if (!_.isArray(o["subgroup-votes"])) {
    o["subgroup-votes"] = _.keys(o["subgroup-votes"]).map(
      (gid: string | number) => {
        return { id: Number(gid), val: o["subgroup-votes"][gid] };
      }
    );
    o["subgroup-votes"].map(remapSubgroupStuff);
  }
  if (!_.isArray(o["subgroup-clusters"])) {
    o["subgroup-clusters"] = _.keys(o["subgroup-clusters"]).map(
      (gid: string | number) => {
        return { id: Number(gid), val: o["subgroup-clusters"][gid] };
      }
    );
    o["subgroup-clusters"].map(remapSubgroupStuff);
  }

  // // Gaps in the gids are not what we want to show users, and they make client development difficult.
  // // So this guarantees that the gids are contiguous. TODO look into Darwin.
  // o = packGids(o);

  // Un-normalize to maintain API consistency.
  // This could removed in a future API version.
  function toObj(a: string | any[]) {
    let obj = {};
    if (!a) {
      return obj;
    }
    for (let i = 0; i < a.length; i++) {
      // Element implicitly has an 'any' type
      // because expression of type 'any' can't be used to index type '{ } '.ts(7053)
      // @ts-ignore
      obj[a[i].id] = a[i].val;
      // Element implicitly has an 'any' type
      // because expression of type 'any' can't be used to index type '{ } '.ts(7053)
      // @ts-ignore
      obj[a[i].id].id = a[i].id;
    }
    return obj;
  }
  function toArray(a: any[]) {
    if (!a) {
      return [];
    }
    return a.map((g: { id: any; val: any }) => {
      let id = g.id;
      g = g.val;
      g.id = id;
      return g;
    });
  }
  o["repness"] = toObj(o["repness"]);
  o["group-votes"] = toObj(o["group-votes"]);
  o["group-clusters"] = toArray(o["group-clusters"]);

  delete o["subgroup-repness"];
  delete o["subgroup-votes"];
  delete o["subgroup-clusters"];
  return o;
}

function updatePcaCache(zid: any, item: { zid: any }) {
  return new Promise(function (
    resolve: (arg0: {
      asPOJO: any;
      asJSON: string;
      asBufferOfGzippedJson: any;
      expiration: number;
    }) => void,
    reject: (arg0: any) => any
  ) {
    delete item.zid; // don't leak zid
    let asJSON = JSON.stringify(item);
    let buf = new Buffer(asJSON, "utf-8");
    zlib.gzip(buf, function (err: any, jsondGzipdPcaBuffer: any) {
      if (err) {
        return reject(err);
      }

      let o = {
        asPOJO: item,
        asJSON: asJSON,
        asBufferOfGzippedJson: jsondGzipdPcaBuffer,
        expiration: Date.now() + 3000,
      };
      // save in LRU cache, but don't update the lastPrefetchedMathTick
      pcaCache.set(zid, o);
      resolve(o);
    });
  });
}

function getPca(zid?: any, math_tick?: number) {
  let cached = pcaCache.get(zid);
  // Object is of type 'unknown'.ts(2571)
  // @ts-ignore
  if (cached && cached.expiration < Date.now()) {
    cached = null;
  }
  // Object is of type 'unknown'.ts(2571)
  // @ts-ignore
  let cachedPOJO = cached && cached.asPOJO;
  if (cachedPOJO) {
    if (cachedPOJO.math_tick <= (math_tick || 0)) {
      console.log(
        "mathpoll related",
        "math was cached but not new: zid=",
        zid,
        "cached math_tick=",
        cachedPOJO.math_tick,
        "query math_tick=",
        math_tick
      );
      return Promise.resolve(null);
    } else {
      console.log("mathpoll related", "math from cache", zid, math_tick);
      return Promise.resolve(cached);
    }
  }

  console.log("mathpoll cache miss", zid, math_tick);

  // NOTE: not caching results from this query for now, think about this later.
  // not caching these means that conversations without new votes might not be cached. (closed conversations may be slower to load)
  // It's probably not difficult to cache, but keeping things simple for now, and only caching things that come down with the poll.

  let queryStart = Date.now();

  return (
    dbPgQuery
      .queryP_readOnly(
        "select * from math_main where zid = ($1) and math_env = ($2);",
        [zid, process.env.MATH_ENV]
      )
      //     Argument of type '(rows: string | any[]) => Promise<any> | null' is not assignable to parameter of type '(value: unknown) => any'.
      // Types of parameters 'rows' and 'value' are incompatible.
      //   Type 'unknown' is not assignable to type 'string | any[]'.
      //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
      // @ts-ignore
      .then((rows: string | any[]) => {
        let queryEnd = Date.now();
        let queryDuration = queryEnd - queryStart;
        addInRamMetric("pcaGetQuery", queryDuration);

        if (!rows || !rows.length) {
          console.log(
            "mathpoll related; after cache miss, unable to find data for",
            {
              zid,
              math_tick,
              math_env: process.env.MATH_ENV,
            }
          );
          return null;
        }
        let item = rows[0].data;

        if (rows[0].math_tick) {
          item.math_tick = Number(rows[0].math_tick);
        }

        if (item.math_tick <= (math_tick || 0)) {
          console.log(
            "mathpoll related",
            "after cache miss, unable to find newer item",
            zid,
            math_tick
          );
          return null;
        }
        console.log(
          "mathpoll related",
          "after cache miss, found item, adding to cache",
          zid,
          math_tick
        );

        processMathObject(item);

        return updatePcaCache(zid, item).then(
          function (o: any) {
            return o;
          },
          function (err: any) {
            return err;
          }
        );
      })
  );
}

function isModerator(zid: any, uid?: any) {
  if (isPolisDev(uid)) {
    return Promise.resolve(true);
  }
  return (
    dbPgQuery
      .queryP_readOnly(
        "select count(*) from conversations where owner in (select uid from users where site_id = (select site_id from users where uid = ($2))) and zid = ($1);",
        [zid, uid]
      )
      //     Argument of type '(rows: { count: number; }[]) => boolean' is not assignable to parameter of type '(value: unknown) => boolean | PromiseLike<boolean>'.
      // Types of parameters 'rows' and 'value' are incompatible.
      //     Type 'unknown' is not assignable to type '{ count: number; }[]'.ts(2345)
      // @ts-ignore
      .then(function (rows: { count: number }[]) {
        return rows[0].count >= 1;
      })
  );
}

function doAddDataExportTask(
  math_env: string | undefined,
  email: string,
  zid: number,
  atDate: number,
  format: string,
  task_bucket: number
) {
  return dbPgQuery.queryP(
    "insert into worker_tasks (math_env, task_data, task_type, task_bucket) values ($1, $2, 'generate_export_data', $3);",
    [
      math_env,
      {
        email: email,
        zid: zid,
        "at-date": atDate,
        format: format,
      },
      task_bucket, // TODO hash the params to get a consistent number?
    ]
  );
}

function getZidForRid(rid: any) {
  return dbPgQuery
    .queryP("select zid from reports where rid = ($1);", [rid])
    .then(
      //     Argument of type '(row: string | any[]) => any' is not assignable to parameter of type '(value: unknown) => any'.
      // Types of parameters 'row' and 'value' are incompatible.
      //   Type 'unknown' is not assignable to type 'string | any[]'.
      //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
      // @ts-ignore
      (row: string | any[]) => {
        if (!row || !row.length) {
          return null;
        }
        return row[0].zid;
      }
    );
}

function getBidIndexToPidMapping(zid: number, math_tick: number) {
  math_tick = math_tick || -1;
  return (
    dbPgQuery
      .queryP_readOnly(
        "select * from math_bidtopid where zid = ($1) and math_env = ($2);",
        [zid, process.env.MATH_ENV]
      )
      //     Argument of type '(rows: string | any[]) => any' is not assignable to parameter of type '(value: unknown) => any'.
      // Types of parameters 'rows' and 'value' are incompatible.
      //   Type 'unknown' is not assignable to type 'string | any[]'.
      //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
      // @ts-ignore
      .then((rows: string | any[]) => {
        if (zid === 12480) {
          console.log("bidToPid", rows[0].data);
        }
        if (!rows || !rows.length) {
          // Could actually be a 404, would require more work to determine that.
          return new Error("polis_err_get_pca_results_missing");
        } else if (rows[0].data.math_tick <= math_tick) {
          return new Error("polis_err_get_pca_results_not_new");
        } else {
          return rows[0].data;
        }
      })
  );
}

function isOwner(zid: any, uid: string) {
  return Conversation.getConversationInfo(zid).then(function (info: {
    owner: any;
  }) {
    console.log("info", 39847534987 + " isOwner " + uid);
    console.log("info", info);
    console.log("info", info.owner === uid);
    return info.owner === uid;
  });
}

function clearCookies(
  req: { headers?: Headers; cookies?: any; p?: any },
  res: {
    clearCookie?: (
      arg0: string,
      arg1: { path: string; domain?: string }
    ) => void;
    status?: (arg0: number) => void;
    _headers?: { [x: string]: any };
    redirect?: (arg0: string) => void;
    set?: (arg0: { "Content-Type": string }) => void;
  }
) {
  let origin = req?.headers?.origin || "";
  let cookieName;
  if (Config.domainOverride || origin.match(/^http:\/\/localhost:[0-9]{4}/)) {
    for (cookieName in req.cookies) {
      // Element implicitly has an 'any' type because expression of type 'string' can't be used to index type '{ e: boolean; token2: boolean; uid2: boolean; uc: boolean; plan: boolean; referrer: boolean; parent_url: boolean; }'.
      // No index signature with a parameter of type 'string' was found on type '{ e: boolean; token2: boolean; uid2: boolean; uc: boolean; plan: boolean; referrer: boolean; parent_url: boolean; }'.ts(7053)
      // @ts-ignore
      if (cookies.COOKIES_TO_CLEAR[cookieName]) {
        res?.clearCookie?.(cookieName, {
          path: "/",
        });
      }
    }
  } else {
    for (cookieName in req.cookies) {
      // Element implicitly has an 'any' type because expression of type 'string' can't be used to index type '{ e: boolean; token2: boolean; uid2: boolean; uc: boolean; plan: boolean; referrer: boolean; parent_url: boolean; }'.
      // No index signature with a parameter of type 'string' was found on type '{ e: boolean; token2: boolean; uid2: boolean; uc: boolean; plan: boolean; referrer: boolean; parent_url: boolean; }'.ts(7053)
      // @ts-ignore
      if (cookies.COOKIES_TO_CLEAR[cookieName]) {
        res?.clearCookie?.(cookieName, {
          path: "/",
          domain: ".pol.is",
        });
      }
    }
    // for (cookieName in req.cookies) {
    //     if (cookies.COOKIES_TO_CLEAR[cookieName]) {
    //         res.clearCookie(cookieName, {path: "/", domain: "www.pol.is"});
    //     }
    // }
  }
  console.log(
    "info",
    "after clear res set-cookie: " +
      JSON.stringify(res?._headers?.["set-cookie"])
  );
}

function getUidByEmail(email: string) {
  email = email.toLowerCase();
  return (
    dbPgQuery
      .queryP_readOnly("SELECT uid FROM users where LOWER(email) = ($1);", [
        email,
      ])
      // Argument of type '(rows: string | any[]) => any' is not assignable to parameter of type '(value: unknown) => any'.
      //   Types of parameters 'rows' and 'value' are incompatible.
      //     Type 'unknown' is not assignable to type 'string | any[]'.
      //       Type 'unknown' is not assignable to type 'any[]'.ts(2345)
      // @ts-ignore
      .then(function (rows: string | any[]) {
        if (!rows || !rows.length) {
          throw new Error("polis_err_no_user_matching_email");
        }
        return rows[0].uid;
      })
  );
}

function sendPasswordResetEmail(
  uid?: any,
  pwresettoken?: any,
  serverName?: any,
  callback?: { (err: any): void; (arg0?: string): void }
) {
  User.getUserInfoForUid(
    uid,
    //     Argument of type '(err: any, userInfo: { hname: any; email: any; }) => void' is not assignable to parameter of type '(arg0: null, arg1?: undefined) => void'.
    // Types of parameters 'userInfo' and 'arg1' are incompatible.
    //     Type 'undefined' is not assignable to type '{ hname: any; email: any; }'.ts(2345)
    // @ts-ignore
    function (err: any, userInfo: { hname: any; email: any }) {
      if (err) {
        return callback?.(err);
      }
      if (!userInfo) {
        return callback?.("missing user info");
      }
      let body = `Hi ${userInfo.hname},

We have just received a password reset request for ${userInfo.email}

To reset your password, visit this page:
${serverName}/pwreset/${pwresettoken}

"Thank you for using Polis`;

      emailSenders
        .sendTextEmail(
          POLIS_FROM_ADDRESS,
          userInfo.email,
          "Polis Password Reset",
          body
        )
        .then(function () {
          callback?.();
        })
        .catch(function (err: any) {
          Log.yell("polis_err_failed_to_email_password_reset_code");
          callback?.(err);
        });
    }
  );
}

function sendPasswordResetEmailFailure(email: any, server: any) {
  let body = `We were unable to find a pol.is account registered with the email address: ${email}

You may have used another email address to create your account.

If you need to create a new account, you can do that here ${server}/home

Feel free to reply to this email if you need help.`;

  return emailSenders.sendTextEmail(
    POLIS_FROM_ADDRESS,
    email,
    "Password Reset Failed",
    body
  );
}

function hashStringToInt32(s: string) {
  let h = 1;
  if (typeof s !== "string" || !s.length) {
    return 99;
  }
  for (var i = 0; i < s.length; i++) {
    h = h * s.charCodeAt(i) * 31;
  }
  if (h < 0) {
    h = -h;
  }
  // fit in 32 bit signed
  while (h > 2147483648) {
    h = h / 2;
  }
  return h;
}

function sendMultipleTextEmails(
  sender: string | undefined,
  recipientArray: any[],
  subject: string,
  text: string
) {
  recipientArray = recipientArray || [];
  return Promise.all(
    recipientArray.map(function (email: string) {
      let promise = emailSenders.sendTextEmail(sender, email, subject, text);
      promise.catch(function (err: any) {
        Log.yell("polis_err_failed_to_email_for_user " + email);
      });
      return promise;
    })
  );
}

function emailFeatureRequest(message: string) {
  const body = `Somebody clicked a dummy button!

${message}`;

  return sendMultipleTextEmails(
    POLIS_FROM_ADDRESS,
    admin_emails,
    "Dummy button clicked!!!",
    body
  ).catch(function (err: any) {
    Log.yell("polis_err_failed_to_email_for_dummy_button");
    Log.yell(message);
  });
}

function doGetConversationsRecent(
  req: { p: { uid?: any; sinceUnixTimestamp: any } },
  res: { json: (arg0: any) => void },
  field: string
) {
  if (!isPolisDev(req.p.uid)) {
    Log.fail(res, 403, "polis_err_no_access_for_this_user");
    return;
  }
  var time = req.p.sinceUnixTimestamp;
  if (_.isUndefined(time)) {
    time = Date.now() - 1000 * 60 * 60 * 24 * 7;
  } else {
    time *= 1000;
  }
  time = parseInt(time);
  dbPgQuery
    .queryP_readOnly(
      "select * from conversations where " + field + " >= ($1);",
      [time]
    )
    .then((rows: any) => {
      res.json(rows);
    })
    .catch((err: any) => {
      Log.fail(res, 403, "polis_err_conversationsRecent", err);
    });
}

function clearCookie(
  req: { [key: string]: any; headers?: { origin: string } },
  res: {
    [key: string]: any;
    clearCookie?: (arg0: any, arg1: { path: string; domain?: string }) => void;
  },
  cookieName: any
) {
  let origin = req?.headers?.origin || "";
  if (Config.domainOverride || origin.match(/^http:\/\/localhost:[0-9]{4}/)) {
    res?.clearCookie?.(cookieName, {
      path: "/",
    });
  } else {
    res?.clearCookie?.(cookieName, {
      path: "/",
      domain: ".pol.is",
    });
    //         res.clearCookie(cookieName, {path: "/", domain: "www.pol.is"});
  }
}

function updateLastInteractionTimeForConversation(zid: any, uid?: any) {
  return dbPgQuery.queryP(
    "update participants set last_interaction = now_as_millis(), nsli = 0 where zid = ($1) and uid = ($2);",
    [zid, uid]
  );
}

function userHasAnsweredZeQuestions(zid: any, answers: string | any[]) {
  // 'new' expression, whose target lacks a construct signature, implicitly has an 'any' type.ts(7009)
  // @ts-ignore
  return new MPromise(
    "userHasAnsweredZeQuestions",
    //     Argument of type '(resolve: () => any, reject: (arg0: Error) => void) => void'
    // is not assignable to parameter of type '(resolve: (value: unknown) => void, reject: (reason?: any) => void) => void'.
    // Types of parameters 'resolve' and 'resolve' are incompatible.ts(2345)
    // @ts-ignore
    function (resolve: () => any, reject: (arg0: Error) => void) {
      getAnswersForConversation(
        zid,
        function (err: any, available_answers: any) {
          if (err) {
            reject(err);
            return;
          }

          let q2a = _.indexBy(available_answers, "pmqid");
          let a2q = _.indexBy(available_answers, "pmaid");
          for (var i = 0; i < answers.length; i++) {
            let pmqid = a2q[answers[i]].pmqid;
            delete q2a[pmqid];
          }
          let remainingKeys = _.keys(q2a);
          let missing = remainingKeys && remainingKeys.length > 0;
          if (missing) {
            return reject(
              new Error(
                "polis_err_metadata_not_chosen_pmqid_" + remainingKeys[0]
              )
            );
          } else {
            return resolve();
          }
        }
      );
    }
  );
}

function getAnswersForConversation(
  zid: any,
  callback: {
    (err: any, available_answers: any): any;
    (arg0: number, arg1?: undefined): void;
  }
) {
  dbPgQuery.query_readOnly(
    "SELECT * from participant_metadata_answers WHERE zid = ($1) AND alive=TRUE;",
    [zid],
    function (err: any, x: { rows: any }) {
      if (err) {
        callback(err);
        return;
      }
      callback(0, x.rows);
    }
  );
}

function saveParticipantMetadataChoices(
  zid: any,
  pid: any,
  answers: any[],
  callback: { (err: any): void; (arg0: number): void }
) {
  // answers is a list of pmaid
  if (!answers || !answers.length) {
    // nothing to save
    return callback(0);
  }

  let q =
    "select * from participant_metadata_answers where zid = ($1) and pmaid in (" +
    answers.join(",") +
    ");";

  dbPgQuery.query(
    q,
    [zid],
    function (
      err: any,
      qa_results: { [x: string]: { pmqid: any }; rows: any }
    ) {
      if (err) {
        console.log("info", "adsfasdfasd");
        return callback(err);
      }

      qa_results = qa_results.rows;
      // Property 'rows' is missing in type 'Dictionary<{ pmqid: any; }>' but required in type '{ [x: string]: { pmqid: any; }; rows: any; }'.ts(2741)
      // @ts-ignore
      qa_results = _.indexBy(qa_results, "pmaid");
      // construct an array of params arrays
      answers = answers.map(function (pmaid: string | number) {
        let pmqid = qa_results[pmaid].pmqid;
        return [zid, pid, pmaid, pmqid];
      });
      // make simultaneous requests to insert the choices
      async.map(
        answers,
        function (x: any, cb: (arg0: number) => void) {
          // ...insert()
          //     .into("participant_metadata_choices")
          //     .
          dbPgQuery.query(
            "INSERT INTO participant_metadata_choices (zid, pid, pmaid, pmqid) VALUES ($1,$2,$3,$4);",
            x,
            function (err: any, results: any) {
              if (err) {
                console.log("info", "sdkfuhsdu");
                return cb(err);
              }
              cb(0);
            }
          );
        },
        function (err: any) {
          if (err) {
            console.log("info", "ifudshf78ds");
            return callback(err);
          }
          // finished with all the inserts
          callback(0);
        }
      );
    }
  );
}

function saveParticipantMetadataChoicesP(zid: any, pid: any, answers: any) {
  return new Promise(function (
    resolve: (arg0: number) => void,
    reject: (arg0: any) => void
  ) {
    saveParticipantMetadataChoices(zid, pid, answers, function (err: any) {
      if (err) {
        reject(err);
      } else {
        resolve(0);
      }
    });
  });
}

function tryToJoinConversation(
  zid: any,
  uid?: any,
  info?: any,
  pmaid_answers?: string | any[]
) {
  console.log("tryToJoinConversation");
  console.dir(arguments);

  function doAddExtendedParticipantInfo() {
    if (info && _.keys(info).length > 0) {
      addExtendedParticipantInfo(zid, uid, info);
    }
  }

  function saveMetadataChoices(pid?: number) {
    if (pmaid_answers && pmaid_answers.length) {
      saveParticipantMetadataChoicesP(zid, pid, pmaid_answers);
    }
  }

  // there was no participant row, so create one
  //   Argument of type '(rows: any[]) => any' is not assignable to parameter of type '(value: unknown) => any'.
  // Types of parameters 'rows' and 'value' are incompatible.
  //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
  // @ts-ignore
  return addParticipant(zid, uid).then(function (rows: any[]) {
    let pid = rows && rows[0] && rows[0].pid;
    let ptpt = rows[0];

    doAddExtendedParticipantInfo();

    if (pmaid_answers && pmaid_answers.length) {
      saveMetadataChoices();
    }
    populateParticipantLocationRecordIfPossible(zid, uid, pid);
    return ptpt;
  });
}

function joinConversation(zid: any, uid?: any, info?: {}, pmaid_answers?: any) {
  function tryJoin() {
    return tryToJoinConversation(zid, uid, info, pmaid_answers);
  }

  function doJoin() {
    // retry up to 10 times
    // NOTE: Shouldn't be needed, since we have an advisory lock in the insert trigger.
    //       However, that doesn't seem to be preventing duplicate pid constraint errors.
    //       Doing this retry in JS for now since it's quick and easy, rather than try to
    //       figure what's wrong with the postgres locks.
    let promise = tryJoin()
      .catch(tryJoin)
      .catch(tryJoin)
      .catch(tryJoin)
      .catch(tryJoin)
      .catch(tryJoin)
      .catch(tryJoin)
      .catch(tryJoin)
      .catch(tryJoin)
      .catch(tryJoin);
    return promise;
  }

  return User.getPidPromise(zid, uid).then(function (pid: number) {
    if (pid >= 0) {
      // already a ptpt, so don't create another
      return;
    } else {
      return doJoin();
    }
  }, doJoin);
}

// returns null if it's missing
function getParticipant(zid: any, uid?: any) {
  // 'new' expression, whose target lacks a construct signature, implicitly has an 'any' type.ts(7009)
  // @ts-ignore
  return new MPromise("getParticipant", function (
    resolve: (arg0: any) => void,
    reject: (arg0: Error) => any
  ) {
    dbPgQuery.query_readOnly(
      "SELECT * FROM participants WHERE zid = ($1) AND uid = ($2);",
      [zid, uid],
      function (err: any, results: { rows: any[] }) {
        if (err) {
          return reject(err);
        }
        if (!results || !results.rows) {
          return reject(new Error("polis_err_getParticipant_failed"));
        }
        resolve(results.rows[0]);
      }
    );
  });
}

function getUsersLocationName(uid?: any) {
  return Promise.all([
    dbPgQuery.queryP_readOnly(
      "select * from facebook_users where uid = ($1);",
      [uid]
    ),
    dbPgQuery.queryP_readOnly("select * from twitter_users where uid = ($1);", [
      uid,
    ]),
    //     No overload matches this call.
    // Overload 1 of 2, '(onFulfill?: ((value: [unknown, unknown]) => Resolvable<{ location: any; source: number; } | null>) | undefined, onReject?: ((error: any) => Resolvable<{ location: any; source: number; } | null>) | undefined): Bluebird<...>', gave the following error.
    //   Argument of type '(o: any[][]) => { location: any; source: number; } | null' is not assignable to parameter of type '(value: [unknown, unknown]) => Resolvable<{ location: any; source: number; } | null>'.
    //     Types of parameters 'o' and 'value' are incompatible.
    //       Type '[unknown, unknown]' is not assignable to type 'any[][]'.
    //         Type 'unknown' is not assignable to type 'any[]'.
    // Overload 2 of 2, '(onfulfilled?: ((value: [unknown, unknown]) => Resolvable<{ location: any; source: number; } | null>) | null | undefined, onrejected?: ((reason: any) => PromiseLike<never>) | null | undefined): Bluebird<...>', gave the following error.
    //   Argument of type '(o: any[][]) => { location: any; source: number; } | null' is not assignable to parameter of type '(value: [unknown, unknown]) => Resolvable<{ location: any; source: number; } | null>'.
    //     Types of parameters 'o' and 'value' are incompatible.
    //       Type '[unknown, unknown]' is not assignable to type 'any[][]'.ts(2769)
    // @ts-ignore
  ]).then(function (o: any[][]) {
    let fb = o[0] && o[0][0];
    let tw = o[1] && o[1][0];
    if (fb && _.isString(fb.location)) {
      return {
        location: fb.location,
        source: LOCATION_SOURCES.Facebook,
      };
    } else if (tw && _.isString(tw.location)) {
      return {
        location: tw.location,
        source: LOCATION_SOURCES.Twitter,
      };
    }
    return null;
  });
}

function geoCodeWithGoogleApi(locationString: string) {
  let googleApiKey = process.env.GOOGLE_API_KEY;
  let address = encodeURI(locationString);

  return new Promise(function (
    resolve: (arg0: any) => void,
    reject: (arg0: string) => void
  ) {
    request
      .get(
        "https://maps.googleapis.com/maps/api/geocode/json?address=" +
          address +
          "&key=" +
          googleApiKey
      )
      .then(function (response: any) {
        response = JSON.parse(response);
        if (response.status !== "OK") {
          reject("polis_err_geocoding_failed");
          return;
        }
        let bestResult = response.results[0]; // NOTE: seems like there could be multiple responses - using first for now
        resolve(bestResult);
      }, reject)
      .catch(reject);
  });
}

function geoCode(locationString: any) {
  return (
    dbPgQuery
      .queryP("select * from geolocation_cache where location = ($1);", [
        locationString,
      ])
      //     Argument of type '(rows: string | any[]) => Bluebird<{ lat: any; lng: any; }> | { lat: any; lng: any; }' is not assignable to parameter of type '(value: unknown) => { lat: any; lng: any; } | PromiseLike<{ lat: any; lng: any; }>'.
      // Types of parameters 'rows' and 'value' are incompatible.
      //   Type 'unknown' is not assignable to type 'string | any[]'.
      //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
      // @ts-ignore
      .then(function (rows: string | any[]) {
        if (!rows || !rows.length) {
          return geoCodeWithGoogleApi(locationString).then(function (result: {
            geometry: { location: { lat: any; lng: any } };
          }) {
            console.log("info", result);
            let lat = result.geometry.location.lat;
            let lng = result.geometry.location.lng;
            // NOTE: not waiting for the response to this - it might Log.fail in the case of a race-condition, since we don't have upsert
            dbPgQuery.queryP(
              "insert into geolocation_cache (location,lat,lng,response) values ($1,$2,$3,$4);",
              [locationString, lat, lng, JSON.stringify(result)]
            );
            let o = {
              lat: lat,
              lng: lng,
            };
            return o;
          });
        } else {
          let o = {
            lat: rows[0].lat,
            lng: rows[0].lng,
          };
          return o;
        }
      })
  );
}

function createParticpantLocationRecord(
  zid: any,
  uid?: any,
  pid?: any,
  lat?: any,
  lng?: any,
  source?: any
) {
  return dbPgQuery.queryP(
    "insert into participant_locations (zid, uid, pid, lat, lng, source) values ($1,$2,$3,$4,$5,$6);",
    [zid, uid, pid, lat, lng, source]
  );
}

function isDuplicateKey(err: {
  code: string | number;
  sqlState: string | number;
  messagePrimary: string | string[];
}) {
  let isdup =
    err.code === 23505 ||
    err.code === "23505" ||
    err.sqlState === 23505 ||
    err.sqlState === "23505" ||
    (err.messagePrimary && err.messagePrimary.includes("duplicate key value"));
  return isdup;
}

function populateParticipantLocationRecordIfPossible(
  zid: any,
  uid?: any,
  pid?: any
) {
  console.log("asdf1", zid, uid, pid);
  getUsersLocationName(uid)
    //     No overload matches this call.
    // Overload 1 of 2, '(onFulfill?: ((value: unknown) => Resolvable<void>) | undefined, onReject?: ((error: any) => Resolvable<void>) | undefined): Bluebird<void>', gave the following error.
    //   Argument of type '(locationData: { location: any; source: any; }) => void' is not assignable to parameter of type '(value: unknown) => Resolvable<void>'.
    //     Types of parameters 'locationData' and 'value' are incompatible.
    //       Type 'unknown' is not assignable to type '{ location: any; source: any; }'.
    // Overload 2 of 2, '(onfulfilled?: ((value: unknown) => Resolvable<void>) | null | undefined, onrejected?: ((reason: any) => PromiseLike<never>) | null | undefined): Bluebird<void>', gave the following error.
    //   Argument of type '(locationData: { location: any; source: any; }) => void' is not assignable to parameter of type '(value: unknown) => Resolvable<void>'.
    //     Types of parameters 'locationData' and 'value' are incompatible.
    //     Type 'unknown' is not assignable to type '{ location: any; source: any; }'.ts(2769)
    // @ts-ignore
    .then(function (locationData: { location: any; source: any }) {
      if (!locationData) {
        console.log("asdf1.nope");
        return;
      }
      console.log(locationData);
      geoCode(locationData.location)
        //         Argument of type '(o: { lat: any; lng: any; }) => void' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.
        // Types of parameters 'o' and 'value' are incompatible.
        //         Type 'unknown' is not assignable to type '{ lat: any; lng: any; }'.ts(2345)
        // @ts-ignore
        .then(function (o: { lat: any; lng: any }) {
          createParticpantLocationRecord(
            zid,
            uid,
            pid,
            o.lat,
            o.lng,
            locationData.source
          ).catch(function (err: any) {
            if (!isDuplicateKey(err)) {
              Log.yell("polis_err_creating_particpant_location_record");
              console.error(err);
            }
          });
        })
        .catch(function (err: any) {
          Log.yell("polis_err_geocoding_01");
          console.error(err);
        });
    })
    .catch(function (err: any) {
      Log.yell("polis_err_fetching_user_location_name");
      console.error(err);
    });
}

function addExtendedParticipantInfo(zid: any, uid?: any, data?: {}) {
  if (!data || !_.keys(data).length) {
    return Promise.resolve();
  }

  let params = Object.assign({}, data, {
    zid: zid,
    uid: uid,
    modified: 9876543212345, // hacky string, will be replaced with the word "default".
  });
  let qUpdate = SQL.sql_participants_extended
    .update(params)
    .where(SQL.sql_participants_extended.zid.equals(zid))
    .and(SQL.sql_participants_extended.uid.equals(uid));
  let qString = qUpdate.toString();
  qString = qString.replace("9876543212345", "now_as_millis()");
  return dbPgQuery.queryP(qString, []);
}

function paramsToStringSortedByName(params: {
  conversation_id?: any;
  email?: any;
}) {
  // Argument of type '(a: number[], b: number[]) => boolean' is not assignable to parameter of type '(a: ["email" | "conversation_id", any], b: ["email" | "conversation_id", any]) => number'.
  //   Type 'boolean' is not assignable to type 'number'.ts(2345)
  // @ts-ignore
  let pairs = _.pairs(params).sort(function (a: number[], b: number[]) {
    return a[0] > b[0];
  });
  const pairsList = pairs.map(function (pair: any[]) {
    return pair.join("=");
  });
  return pairsList.join("&");
}

function createHmacForQueryParams(
  path: string,
  params: { conversation_id?: any; email?: any }
) {
  path = path.replace(/\/$/, ""); // trim trailing "/"
  let s = path + "?" + paramsToStringSortedByName(params);
  let hmac = crypto.createHmac(
    "sha1",
    "G7f387ylIll8yuskuf2373rNBmcxqWYFfHhdsd78f3uekfs77EOLR8wofw"
  );
  hmac.setEncoding("hex");
  hmac.write(s);
  hmac.end();
  let hash = hmac.read();
  return hash;
}

function verifyHmacForQueryParams(
  path: string,
  params: { [x: string]: any; conversation_id?: any; email?: any }
) {
  return new Promise(function (resolve: () => void, reject: () => void) {
    params = _.clone(params);
    let hash = params[HMAC_SIGNATURE_PARAM_NAME];
    delete params[HMAC_SIGNATURE_PARAM_NAME];
    let correctHash = createHmacForQueryParams(path, params);
    // To thwart timing attacks, add some randomness to the response time with setTimeout.
    setTimeout(function () {
      console.log("info", "comparing", correctHash, hash);
      if (correctHash === hash) {
        resolve();
      } else {
        reject();
      }
    });
  });
}

function createNotificationsUnsubscribeUrl(conversation_id: any, email: any) {
  let params = {
    conversation_id: conversation_id,
    email: email,
  };
  let path = "api/v3/notifications/unsubscribe";
  // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
  // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
  // @ts-ignore
  params[HMAC_SIGNATURE_PARAM_NAME] = createHmacForQueryParams(path, params);

  let server = "http://localhost:8000";
  if (!devMode) {
    server = "https://" + process.env.PRIMARY_POLIS_URL;
  }
  return server + "/" + path + "?" + paramsToStringSortedByName(params);
}

function subscribeToNotifications(zid: any, uid?: any, email?: any) {
  let type = 1; // 1 for email
  console.log("info", "subscribeToNotifications", zid, uid);
  return dbPgQuery
    .queryP(
      "update participants_extended set subscribe_email = ($3) where zid = ($1) and uid = ($2);",
      [zid, uid, email]
    )
    .then(function () {
      return dbPgQuery
        .queryP(
          "update participants set subscribed = ($3) where zid = ($1) and uid = ($2);",
          [zid, uid, type]
        )
        .then(function (rows: any) {
          return type;
        });
    });
}

function unsubscribeFromNotifications(zid: any, uid?: any) {
  let type = 0; // 1 for nothing
  return dbPgQuery
    .queryP(
      "update participants set subscribed = ($3) where zid = ($1) and uid = ($2);",
      [zid, uid, type]
    )
    .then(function (rows: any) {
      return type;
    });
}

function getSUZinviteInfo(suzinvite: any) {
  return new Promise(function (
    resolve: (arg0: any) => void,
    reject: (arg0: Error) => any
  ) {
    dbPgQuery.query(
      "SELECT * FROM suzinvites WHERE suzinvite = ($1);",
      [suzinvite],
      function (err: any, results: { rows: string | any[] }) {
        if (err) {
          return reject(err);
        }
        if (!results || !results.rows || !results.rows.length) {
          return reject(new Error("polis_err_no_matching_suzinvite"));
        }
        resolve(results.rows[0]);
      }
    );
  });
}

function xidExists(xid: any, owner: any, uid?: any) {
  return (
    dbPgQuery
      .queryP(
        "select * from xids where xid = ($1) and owner = ($2) and uid = ($3);",
        [xid, owner, uid]
      )
      //     Argument of type '(rows: string | any[]) => number | ""' is not assignable to parameter of type '(value: unknown) => number | "" | PromiseLike<number | "">'.
      // Types of parameters 'rows' and 'value' are incompatible.
      //   Type 'unknown' is not assignable to type 'string | any[]'.
      //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
      // @ts-ignore
      .then(function (rows: string | any[]) {
        return rows && rows.length;
      })
  );
}

function createXidEntry(xid: any, owner: any, uid?: any) {
  return new Promise(function (
    resolve: () => void,
    reject: (arg0: Error) => void
  ) {
    dbPgQuery.query(
      "INSERT INTO xids (uid, owner, xid) VALUES ($1, $2, $3);",
      [uid, owner, xid],
      function (err: any, results: any) {
        if (err) {
          console.error(err);
          reject(new Error("polis_err_adding_xid_entry"));
          return;
        }
        resolve();
      }
    );
  });
}

function deleteSuzinvite(suzinvite: any) {
  return new Promise(function (resolve: () => void, reject: any) {
    dbPgQuery.query(
      "DELETE FROM suzinvites WHERE suzinvite = ($1);",
      [suzinvite],
      function (err: any, results: any) {
        if (err) {
          // resolve, but complain
          Log.yell("polis_err_removing_suzinvite");
        }
        resolve();
      }
    );
  });
}

function joinWithZidOrSuzinvite(o: {
  answers: any;
  existingAuth: boolean;
  suzinvite: any;
  permanentCookieToken: any;
  uid?: any;
  zid: any; // since the zid is looked up using the conversation_id, it's safe to use zid as an invite token. TODO huh?
  referrer: any;
  parent_url: any;
}) {
  return (
    Promise.resolve(o)
      .then(function (o: { suzinvite: any; zid: any }) {
        if (o.suzinvite) {
          return getSUZinviteInfo(o.suzinvite).then(function (
            suzinviteInfo: any
          ) {
            return Object.assign(o, suzinviteInfo);
          });
        } else if (o.zid) {
          return o;
        } else {
          throw new Error("polis_err_missing_invite");
        }
      })
      .then(function (o: { zid: any; conv: any }) {
        console.log("info", "joinWithZidOrSuzinvite convinfo begin");
        return Conversation.getConversationInfo(o.zid).then(function (
          conv: any
        ) {
          console.log("info", "joinWithZidOrSuzinvite convinfo done");
          o.conv = conv;
          return o;
        });
      })
      .then(function (o: { lti_users_only: any; uid?: any }) {
        if (o.lti_users_only) {
          if (o.uid) {
            return (
              dbPgQuery
                .queryP("select * from lti_users where uid = ($1)", [o.uid])
                //               Argument of type '(rows: string | any[]) => { lti_users_only: any; uid?: any; }' is not assignable to parameter of type
                // '(value: unknown) => { lti_users_only: any; uid?: any; } | PromiseLike<{ lti_users_only: any; uid?: any; }>'.
                // Types of parameters 'rows' and 'value' are incompatible.
                //   Type 'unknown' is not assignable to type 'string | any[]'.
                //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
                // @ts-ignore
                .then(function (rows: string | any[]) {
                  if (rows && rows.length) {
                    return o;
                  } else {
                    throw new Error("polis_err_missing_lti_user_for_uid");
                  }
                })
            );
          } else {
            throw new Error("polis_err_need_uid_to_check_lti_users");
          }
        } else {
          return o;
        }
      })
      //       No overload matches this call.
      // Overload 1 of 2, '(onFulfill?: ((value: unknown) => any) | undefined, onReject?: ((error: any) => any) | undefined): Bluebird<any>', gave the following error.
      //   Argument of type '(o: { uid?: any; user: any; }) => any' is not assignable to parameter of type '(value: unknown) => any'.
      //     Types of parameters 'o' and 'value' are incompatible.
      //       Type 'unknown' is not assignable to type '{ uid?: any; user: any; }'.
      // Overload 2 of 2, '(onfulfilled?: ((value: unknown) => any) | null | undefined, onrejected?: ((reason: any) => PromiseLike<never>) | null | undefined): Bluebird<any>', gave the following error.
      //   Argument of type '(o: { uid?: any; user: any; }) => any' is not assignable to parameter of type '(value: unknown) => any'.
      //     Types of parameters 'o' and 'value' are incompatible.
      //     Type 'unknown' is not assignable to type '{ uid?: any; user: any; }'.ts(2769)
      // @ts-ignore
      .then(function (o: { uid?: any; user: any }) {
        console.log("info", "joinWithZidOrSuzinvite userinfo begin");
        if (!o.uid) {
          console.log("info", "joinWithZidOrSuzinvite userinfo nope");
          return o;
        }
        return User.getUserInfoForUid2(o.uid).then(function (user: any) {
          console.log("info", "joinWithZidOrSuzinvite userinfo done");
          o.user = user;
          return o;
        });
      })
      // Commenting out for now until we have proper workflow for user.
      // .then(function(o) {
      //   console.log("info","joinWithZidOrSuzinvite check email");
      // if (o.conv.owner_sees_participation_stats) {
      //   // User stats can be provided either by having the users sign in with polis
      //   // or by having them join via suurls.
      //   if (!(o.user && o.user.email) && !o.suzinvite) { // may want to inspect the contenst of the suzinvite info object instead of just the suzinvite
      //     throw new Error("polis_err_need_full_user_for_zid_" + o.conv.zid + "_and_uid_" + (o.user&&o.user.uid));
      //   }
      // }
      // return o;
      // })
      // @ts-ignore
      .then(function (o: { uid?: any }) {
        // console.log("info","joinWithZidOrSuzinvite check email done");
        if (o.uid) {
          return o;
        } else {
          return User.createDummyUser().then(function (uid?: any) {
            return Object.assign(o, {
              uid: uid,
            });
          });
        }
      })
      // No overload matches this call.
      // Overload 1 of 2, '(onFulfill?: ((value: unknown) => any) | undefined, onReject?: ((error: any) => any) | undefined): Bluebird<any>', gave the following error.
      //   Argument of type '(o: { zid: any; answers: any; }) => any' is not assignable to parameter of type '(value: unknown) => any'.
      //     Types of parameters 'o' and 'value' are incompatible.
      //       Type 'unknown' is not assignable to type '{ zid: any; answers: any; }'.
      // Overload 2 of 2, '(onfulfilled?: ((value: unknown) => any) | null | undefined, onrejected?: ((reason: any) => PromiseLike<never>) | null | undefined): Bluebird<any>', gave the following error.
      //   Argument of type '(o: { zid: any; answers: any; }) => any' is not assignable to parameter of type '(value: unknown) => any'.
      //     Types of parameters 'o' and 'value' are incompatible.
      //     Type 'unknown' is not assignable to type '{ zid: any; answers: any; }'.ts(2769)
      // @ts-ignore
      .then(function (o: { zid: any; answers: any }) {
        return userHasAnsweredZeQuestions(o.zid, o.answers).then(function () {
          // looks good, pass through
          return o;
        });
      })
      //       No overload matches this call.
      // Overload 1 of 2, '(onFulfill?: ((value: unknown) => any) | undefined, onReject?: ((error: any) => any) | undefined): Bluebird<any>', gave the following error.
      //   Argument of type '(o: { referrer: any; parent_url: any; zid: any; uid?: any; answers: any; }) => any' is not assignable to parameter of type '(value: unknown) => any'.
      //     Types of parameters 'o' and 'value' are incompatible.
      //       Type 'unknown' is not assignable to type '{ referrer: any; parent_url: any; zid: any; uid?: any; answers: any; }'.
      // Overload 2 of 2, '(onfulfilled?: ((value: unknown) => any) | null | undefined, onrejected?: ((reason: any) => PromiseLike<never>) | null | undefined): Bluebird<any>', gave the following error.
      //   Argument of type '(o: { referrer: any; parent_url: any; zid: any; uid?: any; answers: any; }) => any' is not assignable to parameter of type '(value: unknown) => any'.
      //     Types of parameters 'o' and 'value' are incompatible.
      //     Type 'unknown' is not assignable to type '{ referrer: any; parent_url: any; zid: any; uid?: any; answers: any; }'.ts(2769)
      // @ts-ignore
      .then(function (o: {
        referrer: any;
        parent_url: any;
        zid: any;
        uid?: any;
        answers: any;
      }) {
        let info: ParticipantInfo = {};
        if (o.referrer) {
          info.referrer = o.referrer;
        }
        if (o.parent_url) {
          info.parent_url = o.parent_url;
        }
        // TODO_REFERRER add info as third arg
        return joinConversation(o.zid, o.uid, info, o.answers).then(function (
          ptpt: any
        ) {
          return Object.assign(o, ptpt);
        });
      })
      //       No overload matches this call.
      // Overload 1 of 2, '(onFulfill?: ((value: unknown) => Resolvable<{ xid: any; conv: { org_id: any; use_xid_whitelist: any; owner: any; };
      // uid?: any; } | undefined>) | undefined, onReject?: ((error: any) => Resolvable<{ xid: any; conv: { ...; }; uid?: any; } | undefined>) | undefined): Bluebird<...>', gave the following error.
      //   Argument of type '(o: { xid: any; conv: { org_id: any; use_xid_whitelist: any; owner: any; }; uid?: any; }) =>
      // { xid: any; conv: { org_id: any; use_xid_whitelist: any; owner: any; }; uid ?: any; } | Promise < { xid: any; conv: { org_id: any; use_xid_whitelist: any; owner: any; }; uid?: any; } |
      // undefined > ' is not assignable to parameter of type '(value: unknown) => Resolvable < { xid: any; conv: { org_id: any; use_xid_whitelist: any; owner: any; }; uid?: any; } | undefined > '.
      //     Types of parameters 'o' and 'value' are incompatible.
      //       Type 'unknown' is not assignable to type '{ xid: any; conv: { org_id: any; use_xid_whitelist: any; owner: any; }; uid?: any; }'.
      // Overload 2 of 2, '(onfulfilled?: ((value: unknown) => Resolvable<{ xid: any; conv: { org_id: any; use_xid_whitelist: any; owner: any; }; uid?: any; }
      // | undefined >) | null | undefined, onrejected ?: ((reason: any) => PromiseLike<never>) | null | undefined): Bluebird <...> ', gave the following error.
      //   Argument of type '(o: { xid: any; conv: { org_id: any; use_xid_whitelist: any; owner: any; }; uid?: any; }) =>
      // { xid: any; conv: { org_id: any; use_xid_whitelist: any; owner: any; }; uid ?: any; } | Promise < { xid: any; conv: { org_id: any; use_xid_whitelist: any; owner: any; }; uid?: any; }
      // | undefined > ' is not assignable to parameter of type '(value: unknown) => Resolvable < { xid: any; conv: { org_id: any; use_xid_whitelist: any; owner: any; }; uid?: any; } | undefined > '.
      //     Types of parameters 'o' and 'value' are incompatible.
      //       Type 'unknown' is not assignable to type '{ xid: any; conv: { org_id: any; use_xid_whitelist: any; owner: any; }; uid?: any; }'.ts(2769)
      // @ts-ignore
      .then(function (o: {
        xid: any;
        conv: { org_id: any; use_xid_whitelist: any; owner: any };
        uid?: any;
      }) {
        if (o.xid) {
          // used for suzinvite case

          return xidExists(o.xid, o.conv.org_id, o.uid).then(function (
            exists: any
          ) {
            if (exists) {
              // skip creating the entry (workaround for posgres's lack of upsert)
              return o;
            }
            var shouldCreateXidEntryPromise = o.conv.use_xid_whitelist
              ? Conversation.isXidWhitelisted(o.conv.owner, o.xid)
              : Promise.resolve(true);
            shouldCreateXidEntryPromise.then((should: any) => {
              if (should) {
                return createXidEntry(o.xid, o.conv.org_id, o.uid).then(
                  function () {
                    return o;
                  }
                );
              } else {
                throw new Error("polis_err_xid_not_whitelisted");
              }
            });
          });
        } else {
          return o;
        }
      })
      //       No overload matches this call.
      // Overload 1 of 2, '(onFulfill?: ((value: unknown) => Resolvable<{ suzinvite: any; }>) | undefined, onReject?: ((error: any) => Resolvable<{ suzinvite: any; }>) | undefined): Bluebird<{ suzinvite: any; }>', gave the following error.
      //   Argument of type '(o: { suzinvite: any; }) => { suzinvite: any; } | Bluebird<{ suzinvite: any; }>' is not assignable to parameter of type '(value: unknown) => Resolvable<{ suzinvite: any; }>'.
      //     Types of parameters 'o' and 'value' are incompatible.
      //       Type 'unknown' is not assignable to type '{ suzinvite: any; }'.
      // Overload 2 of 2, '(onfulfilled?: ((value: unknown) => Resolvable<{ suzinvite: any; }>) | null | undefined, onrejected?: ((reason: any) => PromiseLike<never>) | null | undefined): Bluebird<...>', gave the following error.
      //   Argument of type '(o: { suzinvite: any; }) => { suzinvite: any; } | Bluebird<{ suzinvite: any; }>' is not assignable to parameter of type '(value: unknown) => Resolvable<{ suzinvite: any; }>'.
      //     Types of parameters 'o' and 'value' are incompatible.
      //     Type 'unknown' is not assignable to type '{ suzinvite: any; }'.ts(2769)
      // @ts-ignore
      .then(function (o: { suzinvite: any }) {
        if (o.suzinvite) {
          return deleteSuzinvite(o.suzinvite).then(function () {
            return o;
          });
        } else {
          return o;
        }
      })
  );
}

function recordPermanentCookieZidJoin(permanentCookieToken: any, zid: any) {
  function doInsert() {
    return dbPgQuery.queryP(
      "insert into permanentCookieZidJoins (cookie, zid) values ($1, $2);",
      [permanentCookieToken, zid]
    );
  }
  return dbPgQuery
    .queryP(
      "select zid from permanentCookieZidJoins where cookie = ($1) and zid = ($2);",
      [permanentCookieToken, zid]
    )
    .then(
      //     Argument of type '(rows: string | any[]) => Promise<unknown> | undefined' is not assignable to parameter of type '(value: unknown) => unknown'.
      // Types of parameters 'rows' and 'value' are incompatible.
      //   Type 'unknown' is not assignable to type 'string | any[]'.
      //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
      // @ts-ignore
      function (rows: string | any[]) {
        if (rows && rows.length) {
          // already there
        } else {
          return doInsert();
        }
      },
      function (err: any) {
        console.error(err);
        // hmm, weird, try inserting anyway
        return doInsert();
      }
    );
}

function ifDefinedSet(
  name: string,
  source: { [x: string]: any },
  dest: { [x: string]: any }
) {
  if (!_.isUndefined(source[name])) {
    dest[name] = source[name];
  }
}

function getXids(zid: any) {
  // 'new' expression, whose target lacks a construct signature, implicitly has an 'any' type.ts(7009)
  // @ts-ignore
  return new MPromise("getXids", function (
    resolve: (arg0: any) => void,
    reject: (arg0: string) => void
  ) {
    dbPgQuery.query_readOnly(
      "select pid, xid from xids inner join " +
        "(select * from participants where zid = ($1)) as p on xids.uid = p.uid " +
        " where owner in (select org_id from conversations where zid = ($1));",
      [zid],
      function (err: any, result: { rows: any }) {
        if (err) {
          reject("polis_err_fetching_xids");
          return;
        }
        resolve(result.rows);
      }
    );
  });
}

function createNotificationsSubscribeUrl(conversation_id: any, email: any) {
  let params = {
    conversation_id: conversation_id,
    email: email,
  };
  let path = "api/v3/notifications/subscribe";
  // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
  // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
  // @ts-ignore
  params[HMAC_SIGNATURE_PARAM_NAME] = createHmacForQueryParams(path, params);

  let server = "http://localhost:8000";
  if (!devMode) {
    server = "https://" + process.env.PRIMARY_POLIS_URL;
  }
  return server + "/" + path + "?" + paramsToStringSortedByName(params);
}

function startSessionAndAddCookies(req: any, res: any, uid?: any) {
  return new Promise(function (
    resolve: (arg0: any) => void,
    reject: (arg0: Error) => void
  ) {
    Session.startSession(uid, function (err: any, token: any) {
      if (err) {
        reject(new Error("polis_err_reg_failed_to_start_session"));
        return;
      }
      resolve(cookies.addCookies(req, res, token, uid));
    });
  });
}

function getDomainWhitelist(uid?: any) {
  return (
    dbPgQuery
      .queryP(
        "select * from site_domain_whitelist where site_id = (select site_id from users where uid = ($1));",
        [uid]
      )
      //     Argument of type '(rows: string | any[]) => any' is not assignable to parameter of type '(value: unknown) => any'.
      // Types of parameters 'rows' and 'value' are incompatible.
      //   Type 'unknown' is not assignable to type 'string | any[]'.
      //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
      // @ts-ignore
      .then(function (rows: string | any[]) {
        if (!rows || !rows.length) {
          return "";
        }
        return rows[0].domain_whitelist;
      })
  );
}

function setDomainWhitelist(uid?: any, newWhitelist?: any) {
  // TODO_UPSERT
  return (
    dbPgQuery
      .queryP(
        "select * from site_domain_whitelist where site_id = (select site_id from users where uid = ($1));",
        [uid]
      )
      //     Argument of type '(rows: string | any[]) => Promise<unknown>' is not assignable to parameter of type '(value: unknown) => unknown'.
      // Types of parameters 'rows' and 'value' are incompatible.
      //   Type 'unknown' is not assignable to type 'string | any[]'.
      //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
      // @ts-ignore
      .then(function (rows: string | any[]) {
        if (!rows || !rows.length) {
          return dbPgQuery.queryP(
            "insert into site_domain_whitelist (site_id, domain_whitelist) values ((select site_id from users where uid = ($1)), $2);",
            [uid, newWhitelist]
          );
        } else {
          return dbPgQuery.queryP(
            "update site_domain_whitelist set domain_whitelist = ($2) where site_id = (select site_id from users where uid = ($1));",
            [uid, newWhitelist]
          );
        }
      })
  );
}

function getFirstForPid(votes: string | any[]) {
  let seen = {};
  let len = votes.length;
  let firstVotes = [];
  for (var i = 0; i < len; i++) {
    let vote = votes[i];
    // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
    // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
    // @ts-ignore
    if (!seen[vote.pid]) {
      firstVotes.push(vote);
      // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
      // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
      // @ts-ignore
      seen[vote.pid] = true;
    }
  }
  return firstVotes;
}

function deleteFacebookUserRecord(o: { uid?: any }) {
  if (!isPolisDev(o.uid)) {
    // limit to test accounts for now
    return Promise.reject("polis_err_not_implemented");
  }
  return dbPgQuery.queryP("delete from facebook_users where uid = ($1);", [
    o.uid,
  ]);
}

function emailBadProblemTime(message: string) {
  const body = `Yo, there was a serious problem. Here's the message:

${message}`;

  return emailTeam("Polis Bad Problems!!!", body);
}

function getFriends(fb_access_token: any) {
  // 'getMoreFriends' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.ts(7023)
  // @ts-ignore
  function getMoreFriends(friendsSoFar: any[], urlForNextCall: any) {
    // urlForNextCall includes access token
    return request.get(urlForNextCall).then(
      function (response: { data: string | any[]; paging: { next: any } }) {
        let len = response.data.length;
        if (len) {
          for (var i = 0; i < len; i++) {
            friendsSoFar.push(response.data[i]);
          }
          if (response.paging.next) {
            return getMoreFriends(friendsSoFar, response.paging.next);
          }
          return friendsSoFar;
        } else {
          return friendsSoFar;
        }
      },
      function (err: any) {
        emailBadProblemTime("getMoreFriends failed");
        return friendsSoFar;
      }
    );
  }
  return new Promise(function (
    resolve: (arg0: any) => void,
    reject: (arg0: any) => void
  ) {
    FB.setAccessToken(fb_access_token);
    FB.api(
      "/me/friends",
      function (response: { error: any; data: any[]; paging: { next: any } }) {
        if (response && !response.error) {
          let friendsSoFar = response.data;
          if (response.data.length && response.paging.next) {
            getMoreFriends(friendsSoFar, response.paging.next).then(
              resolve,
              reject
            );
          } else {
            resolve(friendsSoFar || []);
          }
        } else {
          reject(response);
        }
      }
    );
  });
} // end getFriends

function getLocationInfo(fb_access_token: any, location: { id: string }) {
  return new Promise(function (resolve: (arg0: {}) => void, reject: any) {
    if (location && location.id) {
      FB.setAccessToken(fb_access_token);
      FB.api("/" + location.id, function (locationResponse: any) {
        resolve(locationResponse);
      });
    } else {
      resolve({});
    }
  });
}

function updateFacebookUserRecord(
  o: { uid?: any } & {
    // uid provided later
    fb_user_id: any;
    fb_public_profile: any;
    fb_login_status: any;
    // fb_auth_response: fb_auth_response,
    fb_access_token: any;
    fb_granted_scopes: any;
    fb_friends_response: any;
    response: any;
  }
) {
  let profileInfo = o.fb_public_profile;
  let fb_public_profile_string = JSON.stringify(o.fb_public_profile);
  // Create facebook user record
  return dbPgQuery.queryP(
    "update facebook_users set modified=now_as_millis(), fb_user_id=($2), fb_name=($3), fb_link=($4), fb_public_profile=($5), fb_login_status=($6), fb_access_token=($7), fb_granted_scopes=($8), fb_location_id=($9), location=($10), fb_friends_response=($11), response=($12) where uid = ($1);",
    [
      o.uid,
      o.fb_user_id,
      profileInfo.name,
      profileInfo.link,
      fb_public_profile_string,
      o.fb_login_status,
      // o.fb_auth_response,
      o.fb_access_token,
      o.fb_granted_scopes,
      profileInfo.locationInfo && profileInfo.locationInfo.id,
      profileInfo.locationInfo && profileInfo.locationInfo.name,
      o.fb_friends_response || "",
      o.response,
    ]
  );
}

function addFacebookFriends(uid?: any, fb_friends_response?: any[]) {
  let fbFriendIds = (fb_friends_response || [])
    .map(function (friend: { id: string }) {
      return friend.id + "";
    })
    .filter(function (id: string) {
      // NOTE: would just store facebook IDs as numbers, but they're too big for JS numbers.
      let hasNonNumericalCharacters = /[^0-9]/.test(id);
      if (hasNonNumericalCharacters) {
        emailBadProblemTime(
          "found facebook ID with non-numerical characters " + id
        );
      }
      return !hasNonNumericalCharacters;
    })
    .map(function (id: string) {
      return "'" + id + "'"; // wrap in quotes to force pg to treat them as strings
    });
  if (!fbFriendIds.length) {
    return Promise.resolve();
  } else {
    // add friends to the table
    // TODO periodically remove duplicates from the table, and pray for postgres upsert to arrive soon.
    return dbPgQuery.queryP(
      "insert into facebook_friends (uid, friend) select ($1), uid from facebook_users where fb_user_id in (" +
        fbFriendIds.join(",") +
        ");",
      [uid]
    );
  }
}

function createFacebookUserRecord(
  o: { uid?: any } & {
    // uid provided later
    fb_user_id: any;
    fb_public_profile: any;
    fb_login_status: any;
    // fb_auth_response: fb_auth_response,
    fb_access_token: any;
    fb_granted_scopes: any;
    fb_friends_response: any;
    response: any;
  }
) {
  console.log("info", "createFacebookUserRecord");
  console.log("info", "createFacebookUserRecord", JSON.stringify(o));
  console.log("info", o);
  console.log("info", "end createFacebookUserRecord");
  let profileInfo = o.fb_public_profile;
  console.log("info", "createFacebookUserRecord profileInfo");
  console.log("info", profileInfo);
  console.log("info", "end createFacebookUserRecord profileInfo");
  // Create facebook user record
  return dbPgQuery.queryP(
    "insert into facebook_users (uid, fb_user_id, fb_name, fb_link, fb_public_profile, fb_login_status, fb_access_token, fb_granted_scopes, fb_location_id, location, fb_friends_response, response) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);",
    [
      o.uid,
      o.fb_user_id,
      profileInfo.name,
      profileInfo.link,
      JSON.stringify(o.fb_public_profile),
      o.fb_login_status,
      // o.fb_auth_response,
      o.fb_access_token,
      o.fb_granted_scopes,
      profileInfo.locationInfo && profileInfo.locationInfo.id,
      profileInfo.locationInfo && profileInfo.locationInfo.name,
      o.fb_friends_response || "",
      o.response,
    ]
  );
}

function do_handle_POST_auth_facebook(
  req: {
    p: {
      response?: string;
      password?: any;
      uid?: any;
      fb_granted_scopes?: any;
      fb_friends_response?: any;
    };
    cookies?: { [x: string]: any };
  },
  res: {
    json: (arg0: { uid?: any; hname: any; email: any }) => void;
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: {
        (arg0: { uid?: any; hname: any; email: any }): void;
        new (): any;
      };
      send: { (arg0: string): void; new (): any };
    };
  },
  o: { locationInfo?: any; friends: any; info: any }
) {
  // If a pol.is user record exists, and someone logs in with a facebook account that has the same email address, we should bind that facebook account to the pol.is account, and let the user sign in.
  let TRUST_FB_TO_VALIDATE_EMAIL = true;
  let email = o.info.email;
  let hname = o.info.name;
  let fb_friends_response = o.friends;
  let fb_user_id = o.info.id;
  let response = JSON.parse(req?.p?.response || "");
  let fb_public_profile = o.info;
  let fb_login_status = response.status;
  let fb_access_token = response.authResponse.accessToken;
  let verified = o.info.verified;

  let password = req.p.password;
  let uid = req.p.uid;

  console.log("fb_data"); // TODO_REMOVE
  console.dir(o); // TODO_REMOVE

  let fbUserRecord = {
    // uid provided later
    fb_user_id: fb_user_id,
    fb_public_profile: fb_public_profile,
    fb_login_status: fb_login_status,
    fb_access_token: fb_access_token,
    fb_granted_scopes: req.p.fb_granted_scopes,
    fb_friends_response: req.p.fb_friends_response || "",
    response: req.p.response,
  };
  function doFbUserHasAccountLinked(user: {
    fb_user_id: any;
    uid: string;
    hname: any;
    email: any;
  }) {
    if (user.fb_user_id === fb_user_id) {
      updateFacebookUserRecord(
        Object.assign(
          {},
          {
            uid: user.uid,
          },
          fbUserRecord
        )
      )
        .then(
          function () {
            let friendsAddedPromise = fb_friends_response
              ? addFacebookFriends(user.uid, fb_friends_response)
              : Promise.resolve();
            return friendsAddedPromise.then(
              function () {
                startSessionAndAddCookies(req, res, user.uid)
                  .then(function () {
                    res.json({
                      uid: user.uid,
                      hname: user.hname,
                      email: user.email,
                      // token: token
                    });
                  })
                  .catch(function (err: any) {
                    Log.fail(res, 500, "polis_err_reg_fb_start_session2", err);
                  });
              },
              function (err: any) {
                Log.fail(res, 500, "polis_err_linking_fb_friends2", err);
              }
            );
          },
          function (err: any) {
            Log.fail(res, 500, "polis_err_updating_fb_info", err);
          }
        )
        .catch(function (err: any) {
          Log.fail(res, 500, "polis_err_fb_auth_misc", err);
        });
    } else {
      // the user with that email has a different FB account attached
      // so clobber the old facebook_users record and add the new one.
      deleteFacebookUserRecord(user).then(
        function () {
          doFbNotLinkedButUserWithEmailExists(user);
        },
        function (err: any) {
          emailBadProblemTime(
            "facebook auth where user exists with different facebook account " +
              user.uid
          );
          Log.fail(
            res,
            500,
            "polis_err_reg_fb_user_exists_with_different_account"
          );
        }
      );
    }
  } // doFbUserHasAccountLinked

  function doFbNotLinkedButUserWithEmailExists(user: { uid?: any }) {
    // user for this email exists, but does not have FB account linked.
    // user will be prompted for their password, and client will repeat the call with password
    // Log.fail(res, 409, "polis_err_reg_user_exits_with_email_but_has_no_facebook_linked")
    if (!TRUST_FB_TO_VALIDATE_EMAIL && !password) {
      Log.fail(res, 403, "polis_err_user_with_this_email_exists " + email);
    } else {
      let pwPromise = TRUST_FB_TO_VALIDATE_EMAIL
        ? Promise.resolve(true)
        : checkPassword(user.uid, password || "");
      pwPromise.then(
        function (ok: any) {
          if (ok) {
            createFacebookUserRecord(
              Object.assign(
                {},
                {
                  uid: user.uid,
                },
                fbUserRecord
              )
            )
              .then(
                function () {
                  let friendsAddedPromise = fb_friends_response
                    ? addFacebookFriends(user.uid, fb_friends_response)
                    : Promise.resolve();
                  return friendsAddedPromise
                    .then(
                      function () {
                        return startSessionAndAddCookies(
                          req,
                          res,
                          user.uid
                        ).then(function () {
                          return user;
                        });
                      },
                      function (err: any) {
                        Log.fail(res, 500, "polis_err_linking_fb_friends", err);
                      }
                    )
                    .then(
                      //                       Argument of type '(user: { uid?: any; hname: any; email: any; }) => void' is not assignable to parameter of type '(value: void | { uid?: any; }) => void | PromiseLike<void>'.
                      // Types of parameters 'user' and 'value' are incompatible.
                      //   Type 'void | { uid?: any; }' is not assignable to type '{ uid?: any; hname: any; email: any; }'.
                      //                       Type 'void' is not assignable to type '{ uid?: any; hname: any; email: any; }'.ts(2345)
                      // @ts-ignore
                      function (user: { uid?: any; hname: any; email: any }) {
                        res.status(200).json({
                          uid: user.uid,
                          hname: user.hname,
                          email: user.email,
                          // token: token,
                        });
                      },
                      function (err: any) {
                        Log.fail(res, 500, "polis_err_linking_fb_misc", err);
                      }
                    );
                },
                function (err: any) {
                  Log.fail(
                    res,
                    500,
                    "polis_err_linking_fb_to_existing_polis_account",
                    err
                  );
                }
              )
              .catch(function (err: any) {
                Log.fail(
                  res,
                  500,
                  "polis_err_linking_fb_to_existing_polis_account_misc",
                  err
                );
              });
          } else {
            Log.fail(res, 403, "polis_err_password_mismatch");
          }
        },
        function (err: any) {
          Log.fail(res, 500, "polis_err_password_check");
        }
      );
    }
  } // end doFbNotLinkedButUserWithEmailExists

  function doFbNoUserExistsYet(user: any) {
    let promise;
    if (uid) {
      console.log("info", "fb1 5a...");
      // user record already exists, so populate that in case it has missing info
      promise = Promise.all([
        dbPgQuery.queryP("select * from users where uid = ($1);", [uid]),
        dbPgQuery.queryP(
          "update users set hname = ($2) where uid = ($1) and hname is NULL;",
          [uid, hname]
        ),
        dbPgQuery.queryP(
          "update users set email = ($2) where uid = ($1) and email is NULL;",
          [uid, email]
        ),
        //         No overload matches this call.
        // Overload 1 of 2, '(onFulfill?: ((value: [unknown, unknown, unknown]) => any) | undefined, onReject?: ((error: any) => any) | undefined): Bluebird<any>', gave the following error.
        //   Argument of type '(o: any[][]) => any' is not assignable to parameter of type '(value: [unknown, unknown, unknown]) => any'.
        //     Types of parameters 'o' and 'value' are incompatible.
        //       Type '[unknown, unknown, unknown]' is not assignable to type 'any[][]'.
        //         Type 'unknown' is not assignable to type 'any[]'.
        // Overload 2 of 2, '(onfulfilled?: ((value: [unknown, unknown, unknown]) => any) | null | undefined, onrejected?: ((reason: any) => PromiseLike<never>) | null | undefined): Bluebird<any>', gave the following error.
        //   Argument of type '(o: any[][]) => any' is not assignable to parameter of type '(value: [unknown, unknown, unknown]) => any'.
        //     Types of parameters 'o' and 'value' are incompatible.
        //           Type '[unknown, unknown, unknown]' is not assignable to type 'any[][]'.ts(2769)
        // @ts-ignore
      ]).then(function (o: any[][]) {
        let user = o[0][0];
        console.log("info", "fb1 5a");
        console.log("info", user);
        console.log("info", "end fb1 5a");
        return user;
      });
      console.log("info", "fb1 5a....");
    } else {
      console.log("info", "fb1 5b...");
      let query =
        "insert into users " +
        "(email, hname) VALUES " +
        "($1, $2) " +
        "returning *;";
      promise = dbPgQuery
        .queryP(query, [email, hname])
        //       Argument of type '(rows: string | any[]) => any' is not assignable to parameter of type '(value: unknown) => any'.
        // Types of parameters 'rows' and 'value' are incompatible.
        //   Type 'unknown' is not assignable to type 'string | any[]'.
        //         Type 'unknown' is not assignable to type 'any[]'.ts(2345)
        // @ts-ignore
        .then(function (rows: string | any[]) {
          let user = (rows && rows.length && rows[0]) || null;
          console.log("info", "fb1 5b");
          console.log("info", user);
          console.log("info", "end fb1 5b");
          return user;
        });
    }
    // Create user record
    promise
      .then(function (user: any) {
        console.log("info", "fb1 4");
        console.log("info", user);
        console.log("info", "end fb1 4");
        return createFacebookUserRecord(
          Object.assign({}, user, fbUserRecord)
        ).then(function () {
          return user;
        });
      })
      .then(
        function (user: { uid?: any }) {
          console.log("info", "fb1 3");
          console.log("info", user);
          console.log("info", "end fb1 3");
          if (fb_friends_response) {
            return addFacebookFriends(user.uid, fb_friends_response).then(
              function () {
                return user;
              }
            );
          } else {
            // no friends, or this user is first polis user among his/her friends.
            return user;
          }
        },
        function (err: any) {
          Log.fail(res, 500, "polis_err_reg_fb_user_creating_record2", err);
        }
      )
      .then(
        //         Argument of type '(user: { uid?: any; }) => Bluebird<void | { uid?: any; }>' is not assignable to parameter of type '(value: void | { uid?: any; }) => void | { uid?: any; } | PromiseLike<void | { uid?: any; }>'.
        // Types of parameters 'user' and 'value' are incompatible.
        //   Type 'void | { uid?: any; }' is not assignable to type '{ uid?: any; }'.
        //         Type 'void' is not assignable to type '{ uid?: any; }'.ts(2345)
        // @ts-ignore
        function (user: { uid?: any }) {
          console.log("info", "fb1 2");
          console.log("info", user);
          console.log("info", "end fb1 2");
          let uid = user.uid;
          return startSessionAndAddCookies(req, res, uid).then(
            function () {
              return user;
            },
            function (err: any) {
              Log.fail(res, 500, "polis_err_reg_fb_user_creating_record3", err);
            }
          );
        },
        function (err: any) {
          Log.fail(res, 500, "polis_err_reg_fb_user_creating_record", err);
        }
      )
      .then(
        //         Argument of type '(user: { uid?: any; hname: any; email: any; }) => void' is not assignable to parameter of type '(value: void | { uid?: any; }) => void | PromiseLike<void>'.
        // Types of parameters 'user' and 'value' are incompatible.
        //   Type 'void | { uid?: any; }' is not assignable to type '{ uid?: any; hname: any; email: any; }'.
        //         Type 'void' is not assignable to type '{ uid?: any; hname: any; email: any; }'.ts(2345)
        // @ts-ignore
        function (user: { uid?: any; hname: any; email: any }) {
          console.log("info", "fb1");
          console.log("info", user);
          console.log("info", "end fb1");
          res.json({
            uid: user.uid,
            hname: user.hname,
            email: user.email,
            // token: token
          });
        },
        function (err: any) {
          Log.fail(res, 500, "polis_err_reg_fb_user_misc22", err);
        }
      )
      .catch(function (err: any) {
        Log.fail(res, 500, "polis_err_reg_fb_user_misc2", err);
      });
  } // end doFbNoUserExistsYet

  let emailVerifiedPromise = Promise.resolve(true);
  if (!verified) {
    if (email) {
      // Type 'Promise<unknown>' is missing the following properties from type 'Bluebird<boolean>': caught, error, lastly, bind, and 38 more.ts(2740)
      // @ts-ignore
      emailVerifiedPromise = isEmailVerified(email);
    } else {
      emailVerifiedPromise = Promise.resolve(false);
    }
  }

  Promise.all([emailVerifiedPromise]).then(function (a: any[]) {
    let isVerifiedByPolisOrFacebook = a[0];

    if (!isVerifiedByPolisOrFacebook) {
      if (email) {
        CreateUser.doSendVerification(req, email);
        res.status(403).send("polis_err_reg_fb_verification_email_sent");
        return;
      } else {
        res
          .status(403)
          .send("polis_err_reg_fb_verification_noemail_unverified");
        return;
      }
    }

    dbPgQuery
      .queryP(
        "select users.*, facebook_users.fb_user_id from users left join facebook_users on users.uid = facebook_users.uid " +
          "where users.email = ($1) " +
          "   or facebook_users.fb_user_id = ($2) " +
          ";",
        [email, fb_user_id]
      )
      .then(
        //         Argument of type '(rows: string | any[]) => void' is not assignable to parameter of type '(value: unknown) => void | PromiseLike<void>'.
        // Types of parameters 'rows' and 'value' are incompatible.
        //   Type 'unknown' is not assignable to type 'string | any[]'.
        //         Type 'unknown' is not assignable to type 'any[]'.ts(2345)
        // @ts-ignore
        function (rows: string | any[]) {
          let user = (rows && rows.length && rows[0]) || null;
          if (rows && rows.length > 1) {
            // the auth provided us with email and fb_user_id where the email is one polis user, and the fb_user_id is for another.
            // go with the one matching the fb_user_id in this case, and leave the email matching account alone.
            user = _.find(rows, function (row: { fb_user_id: any }) {
              return row.fb_user_id === fb_user_id;
            });
          }
          if (user) {
            if (user.fb_user_id) {
              doFbUserHasAccountLinked(user);
            } else {
              doFbNotLinkedButUserWithEmailExists(user);
            }
          } else {
            doFbNoUserExistsYet(user);
          }
        },
        function (err: any) {
          Log.fail(res, 500, "polis_err_reg_fb_user_looking_up_email", err);
        }
      )
      .catch(function (err: any) {
        Log.fail(res, 500, "polis_err_reg_fb_user_misc", err);
      });
  });
} // end do_handle_POST_auth_facebook

function getDemographicsForVotersOnComments(zid: any, comments: any[]) {
  function isAgree(v: { vote: any }) {
    return v.vote === Utils.polisTypes.reactions.pull;
  }
  function isDisgree(v: { vote: any }) {
    return v.vote === Utils.polisTypes.reactions.push;
  }
  function isPass(v: { vote: any }) {
    return v.vote === Utils.polisTypes.reactions.pass;
  }

  function isGenderMale(demo: { gender: number }) {
    return demo.gender === 0;
  }
  function isGenderFemale(demo: { gender: number }) {
    return demo.gender === 1;
  }
  function isGenderUnknown(demo: { gender: any }) {
    var gender = demo.gender;
    return gender !== 0 && gender !== 1;
  }

  // 0 male, 1 female, 2 other, or NULL
  function getGender(demo: Demo) {
    var gender = demo.fb_gender;
    if (_.isNull(gender) || _.isUndefined(gender)) {
      gender = demo.ms_gender_estimate_fb;
    }
    return gender;
  }

  function getAgeRange(demo: Demo) {
    var currentYear = new Date().getUTCFullYear();
    var birthYear = demo.ms_birth_year_estimate_fb;
    if (_.isNull(birthYear) || _.isUndefined(birthYear) || _.isNaN(birthYear)) {
      return "?";
    }
    var age = currentYear - birthYear;
    if (age < 12) {
      return "0-11";
    } else if (age < 18) {
      return "12-17";
    } else if (age < 25) {
      return "18-24";
    } else if (age < 35) {
      return "25-34";
    } else if (age < 45) {
      return "35-44";
    } else if (age < 55) {
      return "45-54";
    } else if (age < 65) {
      return "55-64";
    } else {
      return "65+";
    }
  }

  return Promise.all([
    dbPgQuery.queryP(
      "select pid,tid,vote from votes_latest_unique where zid = ($1);",
      [zid]
    ),
    dbPgQuery.queryP(
      "select p.pid, d.* from participants p left join demographic_data d on p.uid = d.uid where p.zid = ($1);",
      [zid]
    ),
  ]).then((a: any[]) => {
    var votes = a[0];
    var demo = a[1];
    demo = demo.map((d: Demo) => {
      return {
        pid: d.pid,
        gender: getGender(d),
        ageRange: getAgeRange(d),
      };
    });
    var demoByPid = _.indexBy(demo, "pid");

    votes = votes.map((v: { pid: string | number }) => {
      return _.extend(v, demoByPid[v.pid]);
    });

    var votesByTid = _.groupBy(votes, "tid");

    // TODO maybe we should actually look at gender, then a/d/p %
    // TODO maybe we should actually look at each age range, then a/d/p %
    // that will be more natrual in cases of unequal representation

    return comments.map(
      (c: {
        tid: string | number;
        demographics: {
          gender: {
            m: { agree: any; disagree: any; pass: any };
            f: { agree: any; disagree: any; pass: any };
            "?": { agree: any; disagree: any; pass: any };
          };
          // TODO return all age ranges even if zero.
          age: any;
        };
      }) => {
        var votesForThisComment = votesByTid[c.tid];

        if (!votesForThisComment || !votesForThisComment.length) {
          console.log("skipping");
          // console.log(votesForThisComment);
          return c;
        }

        var agrees = votesForThisComment.filter(isAgree);
        var disagrees = votesForThisComment.filter(isDisgree);
        var passes = votesForThisComment.filter(isPass);

        var votesByAgeRange = _.groupBy(votesForThisComment, "ageRange");

        c.demographics = {
          gender: {
            m: {
              agree: agrees.filter(isGenderMale).length,
              disagree: disagrees.filter(isGenderMale).length,
              pass: passes.filter(isGenderMale).length,
            },
            f: {
              agree: agrees.filter(isGenderFemale).length,
              disagree: disagrees.filter(isGenderFemale).length,
              pass: passes.filter(isGenderFemale).length,
            },
            "?": {
              agree: agrees.filter(isGenderUnknown).length,
              disagree: disagrees.filter(isGenderUnknown).length,
              pass: passes.filter(isGenderUnknown).length,
            },
          },
          // TODO return all age ranges even if zero.
          age: _.mapObject(votesByAgeRange, (votes: any, ageRange: any) => {
            var o = _.countBy(votes, "vote");
            return {
              agree: o[Utils.polisTypes.reactions.pull],
              disagree: o[Utils.polisTypes.reactions.push],
              pass: o[Utils.polisTypes.reactions.pass],
            };
          }),
        };
        return c;
      }
    );
  });
}

function getZinvites(zids: any[]) {
  if (!zids.length) {
    return Promise.resolve(zids);
  }
  zids = _.map(zids, function (zid: any) {
    return Number(zid); // just in case
  });
  zids = _.uniq(zids);

  let uncachedZids = zids.filter(function (zid: any) {
    return !zidToConversationIdCache.get(zid);
  });
  let zidsWithCachedConversationIds = zids
    .filter(function (zid: any) {
      return !!zidToConversationIdCache.get(zid);
    })
    .map(function (zid: any) {
      return {
        zid: zid,
        zinvite: zidToConversationIdCache.get(zid),
      };
    });

  function makeZidToConversationIdMap(arrays: any[]) {
    let zid2conversation_id = {};
    arrays.forEach(function (a: any[]) {
      a.forEach(function (o: { zid: string | number; zinvite: any }) {
        // (property) zid: string | number
        // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
        //           No index signature with a parameter of type 'string' was found onpe '{}'.ts(7053)
        // @ts-ignore
        zid2conversation_id[o.zid] = o.zinvite;
      });
    });
    return zid2conversation_id;
  }

  // 'new' expression, whose target lacks a construct signature, implicitly has an 'any' type.ts(7009)
  // @ts-ignore
  return new MPromise("getZinvites", function (
    resolve: (arg0: {}) => void,
    reject: (arg0: any) => void
  ) {
    if (uncachedZids.length === 0) {
      resolve(makeZidToConversationIdMap([zidsWithCachedConversationIds]));
      return;
    }
    dbPgQuery.query_readOnly(
      "select * from zinvites where zid in (" + uncachedZids.join(",") + ");",
      [],
      function (err: any, result: { rows: any }) {
        if (err) {
          reject(err);
        } else {
          resolve(
            makeZidToConversationIdMap([
              result.rows,
              zidsWithCachedConversationIds,
            ])
          );
        }
      }
    );
  });
}

function addConversationIds(a: any[]) {
  let zids = [];
  for (var i = 0; i < a.length; i++) {
    if (a[i].zid) {
      zids.push(a[i].zid);
    }
  }
  if (!zids.length) {
    return Promise.resolve(a);
  }
  return getZinvites(zids).then(function (zid2conversation_id: {
    [x: string]: any;
  }) {
    return a.map(function (o: { conversation_id: any; zid: string | number }) {
      o.conversation_id = zid2conversation_id[o.zid];
      return o;
    });
  });
}

function finishArray(
  res: {
    status: (arg0: number) => {
      (): any;
      new (): any;
      json: { (arg0: any): void; new (): any };
    };
  },
  a: any
) {
  addConversationIds(a)
    .then(
      function (items: string | any[]) {
        // ensure we don't expose zid
        if (items) {
          for (var i = 0; i < items.length; i++) {
            if (items[i].zid) {
              delete items[i].zid;
            }
          }
        }
        res.status(200).json(items);
      },
      function (err: any) {
        Log.fail(res, 500, "polis_err_finishing_response2A", err);
      }
    )
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_finishing_response2", err);
    });
}

function getTwitterTweetById(twitter_tweet_id: string) {
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

  // 'new' expression, whose target lacks a construct signature, implicitly has an 'any' type.ts(7009)
  // @ts-ignore
  return new MPromise("getTwitterTweet", function (
    resolve: (arg0: any) => void,
    reject: (arg0: any) => void
  ) {
    oauth.get(
      "https://api.twitter.com/1.1/statuses/show.json?id=" + twitter_tweet_id,
      // Argument of type 'undefined' is not assignable to parameter of type 'string'.ts(2345)
      // @ts-ignore
      void 0, //'your user token for this app', //test user token
      void 0, //'your user secret for this app', //test user secret
      function (e: any, data: string, res: any) {
        if (e) {
          console.error(" - - - - get twitter tweet failed - - - -");
          console.error(e);
          reject(e);
        } else {
          data = JSON.parse(data);
          console.dir(data);
          resolve(data);
        }
      }
    );
  });
}

function addParticipant(zid: any, uid?: any) {
  return dbPgQuery
    .queryP("INSERT INTO participants_extended (zid, uid) VALUES ($1, $2);", [
      zid,
      uid,
    ])
    .then(() => {
      return dbPgQuery.queryP(
        "INSERT INTO participants (pid, zid, uid, created) VALUES (NULL, $1, $2, default) RETURNING *;",
        [zid, uid]
      );
    });
}

function getAndInsertTwitterUser(o: any, uid?: any) {
  return getTwitterUserInfo(o, false).then(function (userString: string) {
    const u: UserType = JSON.parse(userString)[0];
    console.log("info", "TWITTER USER INFO");
    console.log("info", u);
    console.log("info", "/TWITTER USER INFO");
    return (
      dbPgQuery
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
            ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *;",
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
        //       Argument of type '(rows: string | any[]) => { twitterUser: UserType; twitterUserDbRecord: any; }' is not assignable to parameter of type '(value: unknown) => { twitterUser: UserType; twitterUserDbRecord: any; } | PromiseLike<{ twitterUser: UserType; twitterUserDbRecord: any; }>'.
        // Types of parameters 'rows' and 'value' are incompatible.
        //   Type 'unknown' is not assignable to type 'string | any[]'.
        //       Type 'unknown' is not assignable to type 'any[]'.ts(2345)
        // @ts-ignore
        .then(function (rows: string | any[]) {
          let record = (rows && rows.length && rows[0]) || null;

          // return the twitter user record
          return {
            twitterUser: u,
            twitterUserDbRecord: record,
          };
        })
    );
  });
}

function createUserFromTwitterInfo(o: any) {
  return User.createDummyUser().then(function (uid?: any) {
    return getAndInsertTwitterUser(o, uid).then(function (result: {
      twitterUser: any;
      twitterUserDbRecord: any;
    }) {
      let u = result.twitterUser;
      let twitterUserDbRecord = result.twitterUserDbRecord;

      return dbPgQuery
        .queryP(
          "update users set hname = ($2) where uid = ($1) and hname is NULL;",
          [uid, u.name]
        )
        .then(function () {
          return twitterUserDbRecord;
        });
    });
  });
}

function addParticipantByTwitterUserId(
  query: Promise<any>,
  o: { twitter_screen_name?: any; twitter_user_id?: any },
  zid: any,
  tweet: { user: any } | null
) {
  function addParticipantAndFinish(uid?: any, twitterUser?: any, tweet?: any) {
    return (
      addParticipant(zid, uid)
        //       Argument of type '(rows: any[]) => { ptpt: any; twitterUser: any; tweet: any; }' is not assignable to parameter of type '(value: unknown) => { ptpt: any; twitterUser: any; tweet: any; } | PromiseLike<{ ptpt: any; twitterUser: any; tweet: any; }>'.
        // Types of parameters 'rows' and 'value' are incompatible.
        //   Type 'unknown' is not assignable to type 'any[]'.ts(2345)
        // @ts-ignore
        .then(function (rows: any[]) {
          let ptpt = rows[0];
          return {
            ptpt: ptpt,
            twitterUser: twitterUser,
            tweet: tweet,
          };
        })
    );
  }
  return query.then(function (rows: string | any[]) {
    if (rows && rows.length) {
      let twitterUser = rows[0];
      let uid = twitterUser.uid;
      return getParticipant(zid, uid)
        .then(function (ptpt: any) {
          if (!ptpt) {
            return addParticipantAndFinish(uid, twitterUser, tweet);
          }
          return {
            ptpt: ptpt,
            twitterUser: twitterUser,
            tweet: tweet,
          };
        })
        .catch(function (err: any) {
          return addParticipantAndFinish(uid, twitterUser, tweet);
        });
    } else {
      // no user records yet
      return createUserFromTwitterInfo(o).then(function (twitterUser: {
        uid?: any;
      }) {
        let uid = twitterUser.uid;
        return (
          addParticipant(zid, uid)
            //           Argument of type '(rows: any[]) => { ptpt: any; twitterUser: { uid?: any; }; tweet: { user: any; } | null; }' is not assignable to parameter of type '(value: unknown) => { ptpt: any; twitterUser: { uid?: any; }; tweet: { user: any; } | null; } | PromiseLike<{ ptpt: any; twitterUser: { uid?: any; }; tweet: { user: any; } | null; }>'.
            // Types of parameters 'rows' and 'value' are incompatible.
            //           Type 'unknown' is not assignable to type 'any[]'.ts(2345)
            // @ts-ignore
            .then(function (rows: any[]) {
              let ptpt = rows[0];
              return {
                ptpt: ptpt,
                twitterUser: twitterUser,
                tweet: tweet,
              };
            })
        );
      });
    }
  });

  // * fetch tweet info
  //   if fails, return failure
  // * look for author in twitter_users
  //   if exists
  //    * use uid to find pid in participants
  //   if not exists
  //    * fetch info about user from twitter api
  //      if fails, ??????
  //      if ok
  //       * create a new user record
  //       * create a twitter record
}

function prepForTwitterComment(twitter_tweet_id: any, zid: any) {
  return getTwitterTweetById(twitter_tweet_id).then(function (tweet: {
    user: any;
  }) {
    let user = tweet.user;
    let twitter_user_id = user.id_str;
    let query = dbPgQuery.queryP(
      "select * from twitter_users where twitter_user_id = ($1);",
      [twitter_user_id]
    );
    return addParticipantByTwitterUserId(
      // Argument of type 'Promise<unknown>' is not assignable to parameter of type 'Bluebird<any>'.ts(2345)
      // @ts-ignore
      query,
      {
        twitter_user_id: twitter_user_id,
      },
      zid,
      tweet
    );
  });
}

function prepForQuoteWithTwitterUser(quote_twitter_screen_name: any, zid: any) {
  let query = dbPgQuery.queryP(
    "select * from twitter_users where screen_name = ($1);",
    [quote_twitter_screen_name]
  );
  return addParticipantByTwitterUserId(
    // Argument of type 'Promise<unknown>' is not assignable to parameter of type 'Bluebird<any>'.
    // Type 'Promise<unknown>' is missing the following properties from type 'Bluebird<any>': caught, error, lastly, bind, and 38 more.ts(2345)
    // @ts-ignore
    query,
    {
      twitter_screen_name: quote_twitter_screen_name,
    },
    zid,
    null
  );
}

function isSpam(o: {
  comment_content: any;
  comment_author: any;
  permalink: string;
  user_ip: any;
  user_agent: any;
  referrer: any;
}) {
  // 'new' expression, whose target lacks a construct signature, implicitly has an 'any' type.ts(7009)
  // @ts-ignore
  return new MPromise("isSpam", function (
    resolve: (arg0: any) => void,
    reject: (arg0: any) => void
  ) {
    akismet.checkSpam(o, function (err: any, spam: any) {
      if (err) {
        reject(err);
      } else {
        resolve(spam);
      }
    });
  });
}

function commentExists(zid: any, txt: any) {
  return (
    dbPgQuery
      .queryP("select zid from comments where zid = ($1) and txt = ($2);", [
        zid,
        txt,
      ])
      //     Argument of type '(rows: string | any[]) => number | ""' is not assignable to parameter of type '(value: unknown) => number | "" | PromiseLike<number | "">'.
      // Types of parameters 'rows' and 'value' are incompatible.
      //   Type 'unknown' is not assignable to type 'string | any[]'.
      //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
      // @ts-ignore
      .then(function (rows: string | any[]) {
        return rows && rows.length;
      })
  );
}

function hasBadWords(txt: string) {
  txt = txt.toLowerCase();
  let tokens = txt.split(" ");
  for (var i = 0; i < tokens.length; i++) {
    if (badwords[tokens[i]]) {
      return true;
    }
  }
  return false;
}

function getNumberOfCommentsWithModerationStatus(zid: any, mod: any) {
  // 'new' expression, whose target lacks a construct signature, implicitly has an 'any' type.ts(7009)
  // @ts-ignore
  return new MPromise("getNumberOfCommentsWithModerationStatus", function (
    resolve: (arg0: any) => void,
    reject: (arg0: any) => void
  ) {
    dbPgQuery.query_readOnly(
      "select count(*) from comments where zid = ($1) and mod = ($2);",
      [zid, mod],
      function (err: any, result: { rows: { count: any }[] }) {
        if (err) {
          reject(err);
        } else {
          let count =
            result && result.rows && result.rows[0] && result.rows[0].count;
          count = Number(count);
          if (isNaN(count)) {
            count = void 0;
          }
          resolve(count);
        }
      }
    );
  });
}

function sendCommentModerationEmail(
  req: any,
  uid: number,
  zid: any,
  unmoderatedCommentCount: string | number
) {
  if (_.isUndefined(unmoderatedCommentCount)) {
    unmoderatedCommentCount = "";
  }
  let body = unmoderatedCommentCount;
  if (unmoderatedCommentCount === 1) {
    body += " Statement is waiting for your review here: ";
  } else {
    body += " Statements are waiting for your review here: ";
  }

  getZinvite(zid)
    .catch(function (err: any) {
      console.error(err);
      Log.yell("polis_err_getting_zinvite");
      return void 0;
    })
    .then(function (zinvite: any) {
      // NOTE: the counter goes in the email body so it doesn't create a new email thread (in Gmail, etc)
      body += createProdModerationUrl(zinvite);
      body += "\n\nThank you for using Polis.";

      // NOTE: adding a changing element (date) at the end to prevent gmail from thinking the URL is a signature, and hiding it. (since the URL doesn't change between emails, Gmail tries to be smart, and hides it)
      // "Sent: " + Date.now() + "\n";

      // NOTE: Adding zid to the subject to force the email client to create a new email thread.
      return sendEmailByUid(
        uid,
        `Waiting for review (conversation ${zinvite})`,
        body
      );
    })
    .catch(function (err: any) {
      console.error(err);
    });
}

function addNotificationTask(zid: any) {
  return dbPgQuery.queryP(
    "insert into notification_tasks (zid) values ($1) on conflict (zid) do update set modified = now_as_millis();",
    [zid]
  );
}

function doVotesPost(
  uid?: any,
  pid?: any,
  conv?: { zid: any; is_slack: any },
  tid?: any,
  voteType?: any,
  weight?: number,
  shouldNotify?: any
) {
  let zid = conv?.zid;
  weight = weight || 0;
  let weight_x_32767 = Math.trunc(weight * 32767); // weight is stored as a SMALLINT, so convert from a [-1,1] float to [-32767,32767] int
  return new Promise(function (
    resolve: (arg0: { conv: any; vote: any }) => void,
    reject: (arg0: string) => void
  ) {
    let query =
      "INSERT INTO votes (pid, zid, tid, vote, weight_x_32767, created) VALUES ($1, $2, $3, $4, $5, default) RETURNING *;";
    let params = [pid, zid, tid, voteType, weight_x_32767];
    dbPgQuery.query(
      query,
      params,
      function (err: any, result: { rows: any[] }) {
        if (err) {
          if (isDuplicateKey(err)) {
            reject("polis_err_vote_duplicate");
          } else {
            console.dir(err);
            reject("polis_err_vote_other");
          }
          return;
        }

        const vote = result.rows[0];

        if (shouldNotify && conv && conv.is_slack) {
          Session.sendSlackEvent({
            type: "vote",
            data: Object.assign(
              {
                uid: uid,
              },
              vote
            ),
          });
        }

        resolve({
          conv: conv,
          vote: vote,
        });
      }
    );
  });
}

function votesPost(
  uid?: any,
  pid?: any,
  zid?: any,
  tid?: any,
  voteType?: any,
  weight?: number,
  shouldNotify?: boolean
) {
  return (
    dbPgQuery
      .queryP_readOnly("select * from conversations where zid = ($1);", [zid])
      //     Argument of type '(rows: string | any[]) => any' is not assignable to parameter of type '(value: unknown) => any'.
      // Types of parameters 'rows' and 'value' are incompatible.
      //   Type 'unknown' is not assignable to type 'string | any[]'.
      //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
      // @ts-ignore
      .then(function (rows: string | any[]) {
        if (!rows || !rows.length) {
          throw "polis_err_unknown_conversation";
        }
        let conv = rows[0];
        if (!conv.is_active) {
          throw "polis_err_conversation_is_closed";
        }
        if (conv.auth_needed_to_vote) {
          return isModerator(zid, uid).then((is_mod: any) => {
            if (is_mod) {
              return conv;
            }
            return Promise.all([
              dbPgQuery.queryP(
                "select * from xids where owner = ($1) and uid = ($2);",
                [conv.owner, uid]
              ),
              User.getSocialInfoForUsers([uid], zid),
              // Binding elements 'xids' and 'info' implicitly have an 'any' type.ts(7031)
              // @ts-ignore
            ]).then(([xids, info]) => {
              var socialAccountIsLinked = info.length > 0;
              // Object is of type 'unknown'.ts(2571)
              // @ts-ignore
              var hasXid = xids.length > 0;
              if (socialAccountIsLinked || hasXid) {
                return conv;
              } else {
                throw "polis_err_post_votes_social_needed";
              }
            });
          });
        }
        return conv;
      })
      .then(function (conv: any) {
        return doVotesPost(uid, pid, conv, tid, voteType, weight, shouldNotify);
      })
  );
}

function updateConversationModifiedTime(zid: any, t?: undefined) {
  let modified = _.isUndefined(t) ? Date.now() : Number(t);
  let query =
    "update conversations set modified = ($2) where zid = ($1) and modified < ($2);";
  let params = [zid, modified];
  if (_.isUndefined(t)) {
    query =
      "update conversations set modified = now_as_millis() where zid = ($1);";
    params = [zid];
  }
  return dbPgQuery.queryP(query, params);
}

function updateVoteCount(zid: any, pid: any) {
  // return dbPgQuery.queryP("update participants set vote_count = vote_count + 1 where zid = ($1) and pid = ($2);",[zid, pid]);
  return dbPgQuery.queryP(
    "update participants set vote_count = (select count(*) from votes where zid = ($1) and pid = ($2)) where zid = ($1) and pid = ($2)",
    [zid, pid]
  );
}

function votesGet(p: { zid?: any; pid?: any; tid?: any }) {
  // 'new' expression, whose target lacks a construct signature, implicitly has an 'any' type.ts(7009)
  // @ts-ignore
  return new MPromise("votesGet", function (
    resolve: (arg0: any) => void,
    reject: (arg0: any) => void
  ) {
    let q = SQL.sql_votes_latest_unique
      .select(SQL.sql_votes_latest_unique.star())
      .where(SQL.sql_votes_latest_unique.zid.equals(p.zid));

    if (!_.isUndefined(p.pid)) {
      q = q.where(SQL.sql_votes_latest_unique.pid.equals(p.pid));
    }
    if (!_.isUndefined(p.tid)) {
      q = q.where(SQL.sql_votes_latest_unique.tid.equals(p.tid));
    }
    dbPgQuery.query_readOnly(
      q.toString(),
      function (err: any, results: { rows: any }) {
        if (err) {
          reject(err);
        } else {
          resolve(results.rows);
        }
      }
    );
  });
} // End votesGet

function selectProbabilistically(
  comments: any,
  priorities: { [x: string]: any },
  nTotal: number,
  nRemaining: number
) {
  // Here we go through all of the comments we might select for the user and add their priority values
  let lookup = _.reduce(
    comments,
    (
      o: { lastCount: any; lookup: any[][] },
      comment: { tid: string | number }
    ) => {
      // If we like, we can use nTotal and nRemaining here to figure out how much we should emphasize the
      // priority, potentially. Maybe we end up with different classes of priorities lists for this purpose?
      // scaling this value in some way may also be helpful.
      let lookup_val = o.lastCount + (priorities[comment.tid] || 1);
      o.lookup.push([lookup_val, comment]);
      o.lastCount = lookup_val;
      return o;
    },
    { lastCount: 0, lookup: [] }
  );
  // We arrange a random number that should fall somewhere in the range of the lookup_vals
  let randomN = Math.random() * lookup.lastCount;
  // Return the first one that has a greater lookup; could eventually replace this with something smarter
  // that does a bisectional lookup if performance becomes an issue. But I want to keep the implementation
  // simple to reason about all other things being equal.
  let result = _.find(lookup.lookup, (x: number[]) => x[0] > randomN);
  let c = result?.[1];
  c.randomN = randomN;
  return c;
}

function getVotesForSingleParticipant(p: { pid: any }) {
  if (_.isUndefined(p.pid)) {
    return Promise.resolve([]);
  }
  return votesGet(p);
}

// This very much follows the outline of the random selection above, but factors out the probabilistic logic
// to the selectProbabilistically fn above.
function getNextPrioritizedComment(
  zid: string,
  pid: string,
  withoutTids: string | any[],
  include_social: any
) {
  // Type '{ zid: string; not_voted_by_pid: string; include_social: any; }' is missing the following properties from type 'CommentType': withoutTids, include_voting_patterns, modIn, pid, and 7 more.ts(2740)
  // @ts-ignore
  let params: CommentType = {
    zid: zid,
    not_voted_by_pid: pid,
    include_social: include_social,
  };
  if (!_.isUndefined(withoutTids) && withoutTids.length) {
    params.withoutTids = withoutTids;
  }
  // What should we set timestamp to below in getPca? Is 0 ok? What triggers updates?
  return Promise.all([
    Comment.getComments(params),
    getPca(zid, 0),
    Comment.getNumberOfCommentsRemaining(zid, pid),
  ]).then((results: any[]) => {
    let comments = results[0];
    let math = results[1];
    let numberOfCommentsRemainingRows = results[2];
    if (!comments || !comments.length) {
      return null;
    } else if (
      !numberOfCommentsRemainingRows ||
      !numberOfCommentsRemainingRows.length
    ) {
      throw new Error(
        "polis_err_getNumberOfCommentsRemaining_" + zid + "_" + pid
      );
    }
    let commentPriorities = math ? math.asPOJO["comment-priorities"] || {} : {};
    let nTotal = Number(numberOfCommentsRemainingRows[0].total);
    let nRemaining = Number(numberOfCommentsRemainingRows[0].remaining);
    let c = selectProbabilistically(
      comments,
      commentPriorities,
      nTotal,
      nRemaining
    );
    c.remaining = nRemaining;
    c.total = nTotal;
    return c;
  });
}

function getCommentTranslations(zid: any, tid: any) {
  return dbPgQuery.queryP(
    "select * from comment_translations where zid = ($1) and tid = ($2);",
    [zid, tid]
  );
}

function getNextComment(
  zid?: any,
  pid?: any,
  withoutTids?: any,
  include_social?: boolean,
  lang?: string
) {
  // return getNextCommentPrioritizingNonPassedComments(zid, pid, withoutTids, !!!!!!!!!!!!!!!!TODO IMPL!!!!!!!!!!!include_social);
  //return getNextCommentRandomly(zid, pid, withoutTids, include_social).then((c) => {
  return getNextPrioritizedComment(zid, pid, withoutTids, include_social).then(
    (c: CommentType) => {
      if (lang && c) {
        const firstTwoCharsOfLang = lang.substr(0, 2);
        return getCommentTranslations(zid, c.tid).then((translations: any) => {
          c.translations = translations;
          let hasMatch = _.some(translations, (t: { lang: string }) => {
            return t.lang.startsWith(firstTwoCharsOfLang);
          });
          if (!hasMatch) {
            return Comment.translateAndStoreComment(
              zid,
              c.tid,
              c.txt,
              lang
            ).then((translation: any) => {
              if (translation) {
                c.translations.push(translation);
              }
              return c;
            });
          }
          return c;
        });
      } else if (c) {
        c.translations = [];
      }
      return c;
    }
  );
}

function addConversationId(
  o: { zid?: any; conversation_id?: any },
  dontUseCache: any
) {
  if (!o.zid) {
    // if no zid, resolve without fetching zinvite.
    return Promise.resolve(o);
  }
  return getZinvite(o.zid, dontUseCache).then(function (conversation_id: any) {
    o.conversation_id = conversation_id;
    return o;
  });
}

function finishOne(
  res: {
    status: (arg0: any) => {
      (): any;
      new (): any;
      json: { (arg0: any): void; new (): any };
    };
  },
  o: { url?: string; zid?: any; currentPid?: any },
  dontUseCache?: boolean | undefined,
  altStatusCode?: number | undefined
) {
  addConversationId(o, dontUseCache)
    .then(
      function (item: { zid: any }) {
        // ensure we don't expose zid
        if (item.zid) {
          delete item.zid;
        }
        let statusCode = altStatusCode || 200;
        res.status(statusCode).json(item);
      },
      function (err: any) {
        Log.fail(res, 500, "polis_err_finishing_responseA", err);
      }
    )
    .catch(function (err: any) {
      Log.fail(res, 500, "polis_err_finishing_response", err);
    });
}

function populateGeoIpInfo(zid: any, uid?: any, ipAddress?: string | null) {
  var userId = process.env.MAXMIND_USERID;
  var licenseKey = process.env.MAXMIND_LICENSEKEY;

  var url = "https://geoip.maxmind.com/geoip/v2.1/city/";
  var contentType =
    "application/vnd.maxmind.com-city+json; charset=UTF-8; version=2.1";

  // "city" is     $0.0004 per query
  // "insights" is $0.002  per query
  var insights = false;

  if (insights) {
    url = "https://geoip.maxmind.com/geoip/v2.1/insights/";
    contentType =
      "application/vnd.maxmind.com-insights+json; charset=UTF-8; version=2.1";
  }
  //   No overload matches this call.
  // Overload 1 of 3, '(uri: string, options?: RequestPromiseOptions | undefined, callback?: RequestCallback | undefined): RequestPromise<any>', gave the following error.
  //   Argument of type '{ method: string; contentType: string; headers: { Authorization: string; }; }' is not assignable to parameter of type 'RequestPromiseOptions'.
  //     Object literal may only specify known properties, and 'contentType' does not exist in type 'RequestPromiseOptions'.
  // Overload 2 of 3, '(uri: string, callback?: RequestCallback | undefined): RequestPromise<any>', gave the following error.
  //   Argument of type '{ method: string; contentType: string; headers: { Authorization: string; }; }' is not assignable to parameter of type 'RequestCallback'.
  //     Object literal may only specify known properties, and 'method' does not exist in type 'RequestCallback'.
  // Overload 3 of 3, '(options: RequiredUriUrl & RequestPromiseOptions, callback?: RequestCallback | undefined): RequestPromise<any>', gave the following error.
  //   Argument of type 'string' is not assignable to parameter of type 'RequiredUriUrl & RequestPromiseOptions'.ts(2769)
  // @ts-ignore
  return request
    .get(url + ipAddress, {
      method: "GET",
      contentType: contentType,
      headers: {
        Authorization:
          "Basic " +
          new Buffer(userId + ":" + licenseKey, "utf8").toString("base64"),
      },
    })
    .then(function (response: string) {
      var parsedResponse = JSON.parse(response);
      console.log("BEGIN MAXMIND RESPONSE");
      console.log(response);
      console.log("END MAXMIND RESPONSE");

      return dbPgQuery.queryP(
        "update participants_extended set modified=now_as_millis(), country_iso_code=($4), encrypted_maxmind_response_city=($3), " +
          "location=ST_GeographyFromText('SRID=4326;POINT(" +
          parsedResponse.location.latitude +
          " " +
          parsedResponse.location.longitude +
          ")'), latitude=($5), longitude=($6) where zid = ($1) and uid = ($2);",
        [
          zid,
          uid,
          Session.encrypt(response),
          parsedResponse.country.iso_code,
          parsedResponse.location.latitude,
          parsedResponse.location.longitude,
        ]
      );
    });
}

function addParticipantAndMetadata(
  zid: any,
  uid?: any,
  req?: {
    cookies: { [x: string]: any };
    p: { parent_url: any };
    headers?: { [x: string]: any };
  },
  permanent_cookie?: any
) {
  let info: { [key: string]: string } = {};
  let parent_url =
    req?.cookies?.[cookies.COOKIES.PARENT_URL] || req?.p?.parent_url;
  let referer =
    req?.cookies[cookies.COOKIES.PARENT_REFERRER] ||
    req?.headers?.["referer"] ||
    req?.headers?.["referrer"];
  if (parent_url) {
    info.parent_url = parent_url;
  }
  if (referer) {
    info.referrer = referer;
  }
  let x_forwarded_for = req?.headers?.["x-forwarded-for"];
  let ip: string | null = null;
  if (x_forwarded_for) {
    let ips = x_forwarded_for;
    ips = ips && ips.split(", ");
    ip = ips.length && ips[0];
    info.encrypted_ip_address = Session.encrypt(ip);
    info.encrypted_x_forwarded_for = Session.encrypt(x_forwarded_for);
  }
  if (permanent_cookie) {
    info.permanent_cookie = permanent_cookie;
  }
  if (req?.headers?.["origin"]) {
    info.origin = req?.headers?.["origin"];
  }
  //   Argument of type '(rows: any[]) => any[]' is not assignable to parameter of type '(value: unknown) => any[] | PromiseLike<any[]>'.
  // Types of parameters 'rows' and 'value' are incompatible.
  //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
  // @ts-ignore
  return addParticipant(zid, uid).then((rows: any[]) => {
    let ptpt = rows[0];
    let pid = ptpt.pid;
    populateParticipantLocationRecordIfPossible(zid, uid, pid);
    addExtendedParticipantInfo(zid, uid, info);
    if (ip) {
      populateGeoIpInfo(zid, uid, ip);
    }
    return rows;
  });
}

function addStar(
  zid: any,
  tid: any,
  pid: any,
  starred: number,
  created?: undefined
) {
  starred = starred ? 1 : 0;
  let query =
    "INSERT INTO stars (pid, zid, tid, starred, created) VALUES ($1, $2, $3, $4, default) RETURNING created;";
  let params = [pid, zid, tid, starred];
  if (!_.isUndefined(created)) {
    query =
      "INSERT INTO stars (pid, zid, tid, starred, created) VALUES ($1, $2, $3, $4, $5) RETURNING created;";
    params.push(created);
  }
  return dbPgQuery.queryP(query, params);
}

// NOTE: only call this in response to a vote. Don't call this from a poll, like /api/v3/nextComment
function addNoMoreCommentsRecord(zid: any, pid: any) {
  return dbPgQuery.queryP(
    "insert into event_ptpt_no_more_comments (zid, pid, votes_placed) values ($1, $2, " +
      "(select count(*) from votes where zid = ($1) and pid = ($2)))",
    [zid, pid]
  );
}

function moderateComment(
  zid: string,
  tid: number,
  active: boolean,
  mod: boolean,
  is_meta: boolean
) {
  return new Promise(function (
    resolve: () => void,
    reject: (arg0: any) => void
  ) {
    dbPgQuery.query(
      "UPDATE COMMENTS SET active=($3), mod=($4), modified=now_as_millis(), is_meta = ($5) WHERE zid=($1) and tid=($2);",
      [zid, tid, active, mod, is_meta],
      function (err: any) {
        if (err) {
          reject(err);
        } else {
          // TODO an optimization would be to only add the task when the comment becomes visible after the mod.
          addNotificationTask(zid);

          resolve();
        }
      }
    );
  });
}

function sendGradeForAssignment(
  oauth_consumer_key: any,
  oauth_consumer_secret: any,
  params: {
    lis_result_sourcedid: string;
    gradeFromZeroToOne: string;
    lis_outcome_service_url: any;
  }
) {
  let replaceResultRequestBody =
    "" +
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<imsx_POXEnvelopeRequest xmlns="http://www.imsglobal.org/services/ltiv1p1/xsd/imsoms_v1p0">' +
    "<imsx_POXHeader>" +
    "<imsx_POXRequestHeaderInfo>" +
    "<imsx_version>V1.0</imsx_version>" +
    "<imsx_messageIdentifier>999999123</imsx_messageIdentifier>" +
    "</imsx_POXRequestHeaderInfo>" +
    "</imsx_POXHeader>" +
    "<imsx_POXBody>" +
    "<replaceResultRequest>" + // parser has???  xml.at_css('imsx_POXBody *:first').name.should == 'replaceResultResponse'
    "<resultRecord>" +
    "<sourcedGUID>" +
    "<sourcedId>" +
    params.lis_result_sourcedid +
    "</sourcedId>" +
    "</sourcedGUID>" +
    "<result>" +
    "<resultScore>" +
    "<language>en</language>" + // this is the formatting of the resultScore (for example europe might use a comma. Just stick to en formatting here.)
    "<textString>" +
    params.gradeFromZeroToOne +
    "</textString>" +
    "</resultScore>" +
    "</result>" +
    "</resultRecord>" +
    "</replaceResultRequest>" +
    "</imsx_POXBody>" +
    "</imsx_POXEnvelopeRequest>";

  let oauth = new OAuth.OAuth(
    // Argument of type 'null' is not assignable to parameter of type 'string'.ts(2345)
    // @ts-ignore
    null, //'https://api.twitter.com/oauth/request_token',
    null, //'https://api.twitter.com/oauth/access_token',
    oauth_consumer_key, //'your application consumer key',
    oauth_consumer_secret, //'your application secret',
    "1.0", //'1.0A',
    null,
    "HMAC-SHA1"
  );
  return new Promise(function (
    resolve: (arg0: any, arg1: any) => void,
    reject: (arg0: any) => void
  ) {
    oauth.post(
      params.lis_outcome_service_url, //'https://api.twitter.com/1.1/trends/place.json?id=23424977',
      // Argument of type 'undefined' is not assignable to parameter of type 'string'.ts(2345)
      // @ts-ignore
      void 0, //'your user token for this app', //test user token
      void 0, //'your user secret for this app', //test user secret
      replaceResultRequestBody,
      "application/xml",
      function (e: any, data: any, res: any) {
        if (e) {
          console.log("info", "grades foo failed");
          console.error(e);
          reject(e);
        } else {
          console.log("info", "grades foo ok!");
          resolve(params, data);
        }
        // console.log("info",require('util').inspect(data));
      }
    );
  });
}

function sendCanvasGradesIfNeeded(zid: any, ownerUid: string) {
  // get the lti_user_ids for participants who voted or commented
  let goodLtiUserIdsPromise = dbPgQuery.queryP(
    "select lti_user_id from " +
      "(select distinct uid from " +
      "(select distinct pid from votes where zid = ($1) UNION " +
      "select distinct pid from comments where zid = ($1)) as x " +
      "inner join participants p on x.pid = p.pid where p.zid = ($1)) as good_uids " +
      "inner join lti_users on good_uids.uid = lti_users.uid;",
    [zid]
  );

  let callbackInfoPromise = dbPgQuery.queryP(
    "select * from canvas_assignment_conversation_info ai " +
      "inner join canvas_assignment_callback_info ci " +
      "on ai.custom_canvas_assignment_id = ci.custom_canvas_assignment_id " +
      "where ai.zid = ($1);",
    [zid]
  );

  let ownerLtiCredsPromise = dbPgQuery.queryP(
    "select * from lti_oauthv1_credentials where uid = ($1);",
    [ownerUid]
  );

  return Promise.all([
    goodLtiUserIdsPromise,
    callbackInfoPromise,
    ownerLtiCredsPromise,
  ]).then(function (results: any[]) {
    let isFullPointsEarningLtiUserId = _.indexBy(results[0], "lti_user_id");
    let callbackInfos = results[1];
    if (!callbackInfos || !callbackInfos.length) {
      // TODO may be able to check for scenarios like missing callback infos, where votes and comments and canvas_assignment_conversation_info exist, and then throw an error
      return;
    }
    let ownerLtiCreds = results[2];
    if (!ownerLtiCreds || !ownerLtiCreds.length) {
      throw new Error(
        "polis_err_lti_oauth_credentials_are_missing " + ownerUid
      );
    }
    ownerLtiCreds = ownerLtiCreds[0];
    if (
      !ownerLtiCreds.oauth_shared_secret ||
      !ownerLtiCreds.oauth_consumer_key
    ) {
      throw new Error("polis_err_lti_oauth_credentials_are_bad " + ownerUid);
    }

    let promises = callbackInfos.map(function (
      assignmentCallbackInfo: Assignment
    ) {
      let gradeFromZeroToOne = isFullPointsEarningLtiUserId[
        assignmentCallbackInfo.lti_user_id
      ]
        ? 1.0
        : 0.0;
      assignmentCallbackInfo.gradeFromZeroToOne = String(gradeFromZeroToOne);
      console.log(
        "info",
        "grades assigned" +
          gradeFromZeroToOne +
          " lti_user_id " +
          assignmentCallbackInfo.lti_user_id
      );
      return sendGradeForAssignment(
        ownerLtiCreds.oauth_consumer_key,
        ownerLtiCreds.oauth_shared_secret,
        assignmentCallbackInfo
      );
    });
    return Promise.all(promises);
  });
}

function updateLocalRecordsToReflectPostedGrades(listOfGradingContexts: any[]) {
  listOfGradingContexts = listOfGradingContexts || [];
  return Promise.all(
    listOfGradingContexts.map(function (gradingContext: {
      gradeFromZeroToOne: string;
      tool_consumer_instance_guid?: any;
      lti_context_id: any;
      lti_user_id: any;
      custom_canvas_assignment_id: any;
    }) {
      console.log(
        "info",
        "grading set to " + gradingContext.gradeFromZeroToOne
      );
      return dbPgQuery.queryP(
        "update canvas_assignment_callback_info set grade_assigned = ($1) where tool_consumer_instance_guid = ($2) and lti_context_id = ($3) and lti_user_id = ($4) and custom_canvas_assignment_id = ($5);",
        [
          gradingContext.gradeFromZeroToOne,
          gradingContext.tool_consumer_instance_guid,
          gradingContext.lti_context_id,
          gradingContext.lti_user_id,
          gradingContext.custom_canvas_assignment_id,
        ]
      );
    })
  );
}

function verifyMetadataAnswersExistForEachQuestion(zid: any) {
  let errorcode = "polis_err_missing_metadata_answers";
  return new Promise(function (
    resolve: () => void,
    reject: (arg0: Error) => void
  ) {
    dbPgQuery.query_readOnly(
      "select pmqid from participant_metadata_questions where zid = ($1);",
      [zid],
      function (err: any, results: { rows: any[] }) {
        if (err) {
          reject(err);
          return;
        }
        if (!results.rows || !results.rows.length) {
          resolve();
          return;
        }
        let pmqids = results.rows.map(function (row: { pmqid: any }) {
          return Number(row.pmqid);
        });
        dbPgQuery.query_readOnly(
          "select pmaid, pmqid from participant_metadata_answers where pmqid in (" +
            pmqids.join(",") +
            ") and alive = TRUE and zid = ($1);",
          [zid],
          function (err: any, results: { rows: any[] }) {
            if (err) {
              reject(err);
              return;
            }
            if (!results.rows || !results.rows.length) {
              reject(new Error(errorcode));
              return;
            }
            let questions = _.reduce(
              pmqids,
              function (o: { [x: string]: number }, pmqid: string | number) {
                o[pmqid] = 1;
                return o;
              },
              {}
            );
            results.rows.forEach(function (row: { pmqid: string | number }) {
              delete questions[row.pmqid];
            });
            if (Object.keys(questions).length) {
              reject(new Error(errorcode));
            } else {
              resolve();
            }
          }
        );
      }
    );
  });
}

// kind of crappy that we're replacing the zinvite.
// This is needed because we initially create a conversation with the POST, then actually set the properties with the subsequent PUT.
// if we stop doing that, we can remove this function.
function generateAndReplaceZinvite(zid: any, generateShortZinvite: any) {
  let len = 12;
  if (generateShortZinvite) {
    len = 6;
  }
  return new Promise(function (
    resolve: (arg0: any) => void,
    reject: (arg0: string) => void
  ) {
    Password.generateToken(len, false, function (err: any, zinvite: any) {
      if (err) {
        return reject("polis_err_creating_zinvite");
      }
      dbPgQuery.query(
        "update zinvites set zinvite = ($1) where zid = ($2);",
        [zinvite, zid],
        function (err: any, results: any) {
          if (err) {
            reject(err);
          } else {
            resolve(zinvite);
          }
        }
      );
    });
  });
}

function getConversationUrl(req: any, zid: any, dontUseCache: boolean) {
  return getZinvite(zid, dontUseCache).then(function (zinvite: any) {
    return buildConversationUrl(req, zinvite);
  });
}

function sendEmailByUid(uid?: any, subject?: string, body?: string | number) {
  return User.getUserInfoForUid2(uid).then(function (userInfo: {
    hname: any;
    email: any;
  }) {
    return emailSenders.sendTextEmail(
      POLIS_FROM_ADDRESS,
      userInfo.hname ? `${userInfo.hname} <${userInfo.email}>` : userInfo.email,
      subject,
      body
    );
  });
}

function addCanvasAssignmentConversationInfoIfNeeded(
  zid: any,
  tool_consumer_instance_guid?: any,
  lti_context_id?: any,
  custom_canvas_assignment_id?: any
) {
  return (
    getCanvasAssignmentInfo(
      tool_consumer_instance_guid,
      lti_context_id,
      custom_canvas_assignment_id
    )
      //     Argument of type '(rows: string | any[]) => number | Promise<unknown>' is not assignable to parameter of type '(value: unknown) => unknown'.
      // Types of parameters 'rows' and 'value' are incompatible.
      //   Type 'unknown' is not assignable to type 'string | any[]'.
      //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
      // @ts-ignore
      .then(function (rows: string | any[]) {
        let exists = rows && rows.length;
        if (exists) {
          return exists;
        } else {
          return dbPgQuery.queryP(
            "insert into canvas_assignment_conversation_info (zid, tool_consumer_instance_guid, lti_context_id, custom_canvas_assignment_id) values ($1, $2, $3, $4);",
            [
              zid,
              tool_consumer_instance_guid,
              lti_context_id,
              custom_canvas_assignment_id,
            ]
          );
        }
      })
  );
}

function getZidForQuestion(
  pmqid: any,
  callback: {
    (err: any, zid?: any): void;
    (arg0: string | null, arg1: undefined): void;
  }
) {
  dbPgQuery.query(
    "SELECT zid FROM participant_metadata_questions WHERE pmqid = ($1);",
    [pmqid],
    function (err: any, result: { rows: string | any[] }) {
      if (err) {
        console.log("info", err);
        callback(err);
        return;
      }
      if (!result.rows || !result.rows.length) {
        callback("polis_err_zid_missing_for_question");
        return;
      }
      callback(null, result.rows[0].zid);
    }
  );
}

function isConversationOwner(
  zid: any,
  uid?: any,
  callback?: {
    (err: any): void;
    (err: any): void;
    (err: any): void;
    (err: any, foo: any): void;
    (err: any, foo: any): void;
    (arg0: any): void;
  }
) {
  // if (true) {
  //     callback(null); // TODO remove!
  //     return;
  // }
  dbPgQuery.query_readOnly(
    "SELECT * FROM conversations WHERE zid = ($1) AND owner = ($2);",
    [zid, uid],
    function (err: number, docs: { rows: string | any[] }) {
      if (!docs || !docs.rows || docs.rows.length === 0) {
        err = err || 1;
      }
      callback?.(err);
    }
  );
}

function deleteMetadataQuestionAndAnswers(
  pmqid: any,
  callback: { (err: any): void; (arg0: null): void }
) {
  // dbPgQuery.query("update participant_metadata_choices set alive = FALSE where pmqid = ($1);", [pmqid], function(err) {
  //     if (err) {callback(93847834); return;}
  dbPgQuery.query(
    "update participant_metadata_answers set alive = FALSE where pmqid = ($1);",
    [pmqid],
    function (err: any) {
      if (err) {
        callback(err);
        return;
      }
      dbPgQuery.query(
        "update participant_metadata_questions set alive = FALSE where pmqid = ($1);",
        [pmqid],
        function (err: any) {
          if (err) {
            callback(err);
            return;
          }
          callback(null);
        }
      );
    }
  );
  // });
}

function getZidForAnswer(
  pmaid: any,
  callback: {
    (err: any, zid: any): void;
    (arg0: string | null, arg1?: undefined): void;
  }
) {
  dbPgQuery.query(
    "SELECT zid FROM participant_metadata_answers WHERE pmaid = ($1);",
    [pmaid],
    function (err: any, result: { rows: string | any[] }) {
      if (err) {
        callback(err);
        return;
      }
      if (!result.rows || !result.rows.length) {
        callback("polis_err_zid_missing_for_answer");
        return;
      }
      callback(null, result.rows[0].zid);
    }
  );
}

function deleteMetadataAnswer(
  pmaid: any,
  callback: { (err: any): void; (arg0: null): void }
) {
  // dbPgQuery.query("update participant_metadata_choices set alive = FALSE where pmaid = ($1);", [pmaid], function(err) {
  //     if (err) {callback(34534545); return;}
  dbPgQuery.query(
    "update participant_metadata_answers set alive = FALSE where pmaid = ($1);",
    [pmaid],
    function (err: any) {
      if (err) {
        callback(err);
        return;
      }
      callback(null);
    }
  );
  // });
}

function getChoicesForConversation(zid: any) {
  return new Promise(function (
    resolve: (arg0: never[]) => void,
    reject: (arg0: any) => void
  ) {
    dbPgQuery.query_readOnly(
      "select * from participant_metadata_choices where zid = ($1) and alive = TRUE;",
      [zid],
      function (err: any, x: { rows: any }) {
        if (err) {
          reject(err);
          return;
        }
        if (!x || !x.rows) {
          resolve([]);
          return;
        }
        resolve(x.rows);
      }
    );
  });
}

function createReport(zid: any) {
  //   Argument of type '(report_id: string) => Promise<unknown>' is not assignable to parameter of type '(value: unknown) => unknown'.
  // Types of parameters 'report_id' and 'value' are incompatible.
  //     Type 'unknown' is not assignable to type 'string'.ts(2345)
  // @ts-ignore
  return Password.generateTokenP(20, false).then(function (report_id: string) {
    report_id = "r" + report_id;
    return dbPgQuery.queryP(
      "insert into reports (zid, report_id) values ($1, $2);",
      [zid, report_id]
    );
  });
}

function getConversationHasMetadata(zid: any) {
  return new Promise(function (
    resolve: (arg0: boolean) => void,
    reject: (arg0: string) => any
  ) {
    dbPgQuery.query_readOnly(
      "SELECT * from participant_metadata_questions where zid = ($1)",
      [zid],
      function (err: any, metadataResults: { rows: string | any[] }) {
        if (err) {
          return reject("polis_err_get_conversation_metadata_by_zid");
        }
        let hasNoMetadata =
          !metadataResults ||
          !metadataResults.rows ||
          !metadataResults.rows.length;
        resolve(!hasNoMetadata);
      }
    );
  });
}

function getConversationTranslations(zid: any, lang: string) {
  const firstTwoCharsOfLang = lang.substr(0, 2);
  return dbPgQuery.queryP(
    "select * from conversation_translations where zid = ($1) and lang = ($2);",
    [zid, firstTwoCharsOfLang]
  );
}

function getConversationTranslationsMinimal(zid: any, lang: any) {
  if (!lang) {
    return Promise.resolve([]);
  }
  //   Argument of type '(rows: string | any[]) => string | any[]' is not assignable to parameter of type '(value: unknown) => string | any[] | PromiseLike<string | any[]>'.
  // Types of parameters 'rows' and 'value' are incompatible.
  //   Type 'unknown' is not assignable to type 'string | any[]'.
  //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
  // @ts-ignore
  return getConversationTranslations(zid, lang).then(function (
    rows: string | any[]
  ) {
    for (let i = 0; i < rows.length; i++) {
      delete rows[i].zid;
      delete rows[i].created;
      delete rows[i].modified;
      delete rows[i].src;
    }
    return rows;
  });
}

function ifDefinedFirstElseSecond(first: any, second: boolean) {
  return _.isUndefined(first) ? second : first;
}

function getOneConversation(zid: any, uid?: any, lang?: null) {
  return Promise.all([
    dbPgQuery.queryP_readOnly(
      "select * from conversations left join  (select uid, site_id from users) as u on conversations.owner = u.uid where conversations.zid = ($1);",
      [zid]
    ),
    getConversationHasMetadata(zid),
    _.isUndefined(uid) ? Promise.resolve({}) : User.getUserInfoForUid2(uid),
    getConversationTranslationsMinimal(zid, lang),
  ]).then(function (results: any[]) {
    let conv = results[0] && results[0][0];
    let convHasMetadata = results[1];
    let requestingUserInfo = results[2];
    let translations = results[3];

    conv.auth_opt_allow_3rdparty = ifDefinedFirstElseSecond(
      conv.auth_opt_allow_3rdparty,
      true
    );
    conv.auth_opt_fb_computed =
      conv.auth_opt_allow_3rdparty &&
      ifDefinedFirstElseSecond(conv.auth_opt_fb, true);
    conv.auth_opt_tw_computed =
      conv.auth_opt_allow_3rdparty &&
      ifDefinedFirstElseSecond(conv.auth_opt_tw, true);

    conv.translations = translations;

    return User.getUserInfoForUid2(conv.owner).then(function (ownerInfo: {
      hname: any;
    }) {
      let ownername = ownerInfo.hname;
      if (convHasMetadata) {
        conv.hasMetadata = true;
      }
      if (!_.isUndefined(ownername) && conv.context !== "hongkong2014") {
        conv.ownername = ownername;
      }
      conv.is_mod = conv.site_id === requestingUserInfo.site_id;
      conv.is_owner = conv.owner === uid;
      conv.pp = false; // participant pays (WIP)
      delete conv.uid; // conv.owner is what you want, uid shouldn't be returned.
      return conv;
    });
  });
}

function createOneSuzinvite(
  xid: any,
  zid: any,
  owner: any,
  generateSingleUseUrl: (arg0: any, arg1: any) => any
) {
  return generateSUZinvites(1).then(function (suzinviteArray: any[]) {
    let suzinvite = suzinviteArray[0];
    return dbPgQuery
      .queryP(
        "INSERT INTO suzinvites (suzinvite, xid, zid, owner) VALUES ($1, $2, $3, $4);",
        [suzinvite, xid, zid, owner]
      )
      .then(function (result: any) {
        return getZinvite(zid);
      })
      .then(function (conversation_id: any) {
        return {
          zid: zid,
          conversation_id: conversation_id,
        };
      })
      .then(function (o: { zid: any; conversation_id: any }) {
        return {
          zid: o.zid,
          conversation_id: o.conversation_id,
          suurl: generateSingleUseUrl(o.conversation_id, suzinvite),
        };
      });
  });
}

function generateSingleUseUrl(
  req: any,
  conversation_id: string,
  suzinvite: string
) {
  return (
    Config.getServerNameWithProtocol(req) +
    "/ot/" +
    conversation_id +
    "/" +
    suzinvite
  );
}

function createModerationUrl(
  req: { p?: ConversationType; protocol?: string; headers?: Headers },
  zinvite: string
) {
  let server = devMode ? "http://localhost:5000" : "https://pol.is";
  if (Config.domainOverride) {
    server = req?.protocol + "://" + Config.domainOverride;
  }

  if (req?.headers?.host?.includes("preprod.pol.is")) {
    server = "https://preprod.pol.is";
  }
  let url = server + "/m/" + zinvite;
  return url;
}

function getConversations(
  req: {
    p: ConversationType;
  },
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
  let xid = req.p.xid;
  // let course_invite = req.p.course_invite;
  let include_all_conversations_i_am_in =
    req.p.include_all_conversations_i_am_in;
  let want_mod_url = req.p.want_mod_url;
  let want_upvoted = req.p.want_upvoted;
  let want_inbox_item_admin_url = req.p.want_inbox_item_admin_url;
  let want_inbox_item_participant_url = req.p.want_inbox_item_participant_url;
  let want_inbox_item_admin_html = req.p.want_inbox_item_admin_html;
  let want_inbox_item_participant_html = req.p.want_inbox_item_participant_html;
  let context = req.p.context;
  // let limit = req.p.limit;
  console.log("info", "thecontext", context);
  // this statement is currently a subset of the next one
  // let zidListQuery = "select zid from page_ids where site_id = (select site_id from users where uid = ($1))";

  // include conversations started by people with the same site_id as me
  // 1's indicate that the conversations are there for that reason
  let zidListQuery =
    "select zid, 1 as type from conversations where owner in (select uid from users where site_id = (select site_id from users where uid = ($1)))";
  if (include_all_conversations_i_am_in) {
    zidListQuery +=
      " UNION ALL select zid, 2 as type from participants where uid = ($1)"; // using UNION ALL instead of UNION to ensure we get all the 1's and 2's (I'm not sure if we can guarantee the 2's won't clobber some 1's if we use UNION)
  }
  zidListQuery += ";";
  dbPgQuery.query_readOnly(
    zidListQuery,
    [uid],
    function (err: any, results: { rows: any }) {
      if (err) {
        Log.fail(res, 500, "polis_err_get_conversations_participated_in", err);
        return;
      }

      let participantInOrSiteAdminOf =
        (results && results.rows && _.pluck(results.rows, "zid")) || null;
      let siteAdminOf = _.filter(
        results.rows,
        function (row: { type: number }) {
          return row.type === 1;
        }
      );
      let isSiteAdmin = _.indexBy(siteAdminOf, "zid");

      let query = SQL.sql_conversations.select(SQL.sql_conversations.star());

      let isRootsQuery = false;
      let orClauses;
      if (!_.isUndefined(req.p.context)) {
        if (req.p.context === "/") {
          console.log("info", "asdf" + req.p.context + "asdf");
          // root of roots returns all public conversations
          // TODO lots of work to decide what's relevant
          // There is a bit of mess here, because we're returning both public 'roots' conversations, and potentially private conversations that you are already in.
          orClauses = SQL.sql_conversations.is_public.equals(true);
          isRootsQuery = true; // more conditions follow in the ANDs below
        } else {
          // knowing a context grants access to those conversations (for now at least)
          console.log("info", "CONTEXT", context);
          orClauses = SQL.sql_conversations.context.equals(req.p.context);
        }
      } else {
        orClauses = SQL.sql_conversations.owner.equals(uid);
        if (participantInOrSiteAdminOf.length) {
          orClauses = orClauses.or(
            SQL.sql_conversations.zid.in(participantInOrSiteAdminOf)
          );
        }
      }
      query = query.where(orClauses);
      if (!_.isUndefined(req.p.course_invite)) {
        query = query.and(
          SQL.sql_conversations.course_id.equals(req.p.course_id)
        );
      }
      // query = query.where("("+ or_clauses.join(" OR ") + ")");
      if (!_.isUndefined(req.p.is_active)) {
        query = query.and(
          SQL.sql_conversations.is_active.equals(req.p.is_active)
        );
      }
      if (!_.isUndefined(req.p.is_draft)) {
        query = query.and(
          SQL.sql_conversations.is_draft.equals(req.p.is_draft)
        );
      }
      if (!_.isUndefined(req.p.zid)) {
        query = query.and(SQL.sql_conversations.zid.equals(zid));
      }
      if (isRootsQuery) {
        query = query.and(SQL.sql_conversations.context.isNotNull());
      }

      //query = whereOptional(query, req.p, 'owner');
      query = query.order(SQL.sql_conversations.created.descending);

      if (!_.isUndefined(req.p.limit)) {
        query = query.limit(req.p.limit);
      } else {
        query = query.limit(999); // TODO paginate
      }
      dbPgQuery.query_readOnly(
        query.toString(),
        function (err: any, result: { rows: never[] }) {
          if (err) {
            Log.fail(res, 500, "polis_err_get_conversations", err);
            return;
          }
          let data = result.rows || [];
          addConversationIds(data)
            .then(function (data: any[]) {
              let suurlsPromise;
              if (xid) {
                suurlsPromise = Promise.all(
                  data.map(function (conv: { zid: any; owner: any }) {
                    return createOneSuzinvite(
                      xid,
                      conv.zid,
                      conv.owner, // TODO think: conv.owner or uid?
                      _.partial(generateSingleUseUrl, req)
                    );
                  })
                );
              } else {
                suurlsPromise = Promise.resolve();
              }
              let upvotesPromise =
                uid && want_upvoted
                  ? dbPgQuery.queryP_readOnly(
                      "select zid from upvotes where uid = ($1);",
                      [uid]
                    )
                  : Promise.resolve();

              return Promise.all([suurlsPromise, upvotesPromise]).then(
                function (x: any[]) {
                  let suurlData = x[0];
                  let upvotes = x[1];
                  if (suurlData) {
                    suurlData = _.indexBy(suurlData, "zid");
                  }
                  if (upvotes) {
                    upvotes = _.indexBy(upvotes, "zid");
                  }
                  data.forEach(function (conv: {
                    is_owner: boolean;
                    owner: any;
                    mod_url: string;
                    conversation_id: string;
                    inbox_item_admin_url: string;
                    inbox_item_participant_url: string;
                    inbox_item_admin_html: string;
                    topic: string;
                    created: string | number | Date;
                    inbox_item_admin_html_escaped: any;
                    inbox_item_participant_html: string;
                    inbox_item_participant_html_escaped: any;
                    url: string;
                    upvoted: boolean;
                    modified: number;
                    is_mod: any;
                    is_anon: any;
                    is_active: any;
                    is_draft: any;
                    is_public: any;
                    zid?: string | number;
                    context?: string;
                  }) {
                    conv.is_owner = conv.owner === uid;
                    let root = Config.getServerNameWithProtocol(req);

                    if (want_mod_url) {
                      // TODO make this into a moderation invite URL so others can join Issue #618
                      conv.mod_url = createModerationUrl(
                        req,
                        conv.conversation_id
                      );
                    }
                    if (want_inbox_item_admin_url) {
                      conv.inbox_item_admin_url =
                        root + "/iim/" + conv.conversation_id;
                    }
                    if (want_inbox_item_participant_url) {
                      conv.inbox_item_participant_url =
                        root + "/iip/" + conv.conversation_id;
                    }
                    if (want_inbox_item_admin_html) {
                      conv.inbox_item_admin_html =
                        "<a href='" +
                        root +
                        "/" +
                        conv.conversation_id +
                        "'>" +
                        (conv.topic || conv.created) +
                        "</a>" +
                        " <a href='" +
                        root +
                        "/m/" +
                        conv.conversation_id +
                        "'>moderate</a>";

                      conv.inbox_item_admin_html_escaped =
                        conv.inbox_item_admin_html.replace(/'/g, "\\'");
                    }
                    if (want_inbox_item_participant_html) {
                      conv.inbox_item_participant_html =
                        "<a href='" +
                        root +
                        "/" +
                        conv.conversation_id +
                        "'>" +
                        (conv.topic || conv.created) +
                        "</a>";
                      conv.inbox_item_participant_html_escaped =
                        conv.inbox_item_admin_html.replace(/'/g, "\\'");
                    }

                    if (suurlData) {
                      conv.url = suurlData[conv.zid || ""].suurl;
                    } else {
                      conv.url = buildConversationUrl(
                        req,
                        conv.conversation_id
                      );
                    }
                    if (upvotes && upvotes[conv.zid || ""]) {
                      conv.upvoted = true;
                    }
                    conv.created = Number(conv.created);
                    conv.modified = Number(conv.modified);

                    // if there is no topic, provide a UTC timstamp instead
                    if (_.isUndefined(conv.topic) || conv.topic === "") {
                      conv.topic = new Date(conv.created).toUTCString();
                    }

                    conv.is_mod = conv.is_owner || isSiteAdmin[conv.zid || ""];

                    // Make sure zid is not exposed
                    delete conv.zid;

                    delete conv.is_anon;
                    delete conv.is_active;
                    delete conv.is_draft;
                    delete conv.is_public;
                    if (conv.context === "") {
                      delete conv.context;
                    }
                  });

                  res.status(200).json(data);
                },
                function (err: any) {
                  Log.fail(res, 500, "polis_err_get_conversations_surls", err);
                }
              );
            })
            .catch(function (err: any) {
              Log.fail(res, 500, "polis_err_get_conversations_misc", err);
            });
        }
      );
    }
  );
}

function isUserAllowedToCreateConversations(
  uid?: any,
  callback?: {
    (err: any, isAllowed: any): void;
    (err: any, isAllowed: any): void;
    (arg0: null, arg1: boolean): void;
  }
) {
  callback?.(null, true);
  // dbPgQuery.query("select is_owner from users where uid = ($1);", [uid], function(err, results) {
  //     if (err) { return callback(err); }
  //     if (!results || !results.rows || !results.rows.length) {
  //         return callback(1);
  //     }
  //     callback(null, results.rows[0].is_owner);
  // });
}

function failWithRetryRequest(res: {
  setHeader: (arg0: string, arg1: number) => void;
  writeHead: (arg0: number) => {
    (): any;
    new (): any;
    send: { (arg0: number): void; new (): any };
  };
}) {
  res.setHeader("Retry-After", 0);
  console.warn(57493875);
  res.writeHead(500).send(57493875);
}

function buildConversationUrl(req: any, zinvite: string | null) {
  return Config.getServerNameWithProtocol(req) + "/" + zinvite;
}

function isOwnerOrParticipant(
  zid: any,
  uid?: any,
  callback?: { (): void; (arg0: null): void }
) {
  // TODO should be parallel.
  // look into bluebird, use 'some' https://github.com/petkaantonov/bluebird
  User.getPid(zid, uid, function (err: any, pid: number) {
    if (err || pid < 0) {
      isConversationOwner(zid, uid, function (err: any) {
        callback?.(err);
      });
    } else {
      callback?.(null);
    }
  });
}

function emailTeam(subject: string, body: string) {
  return sendMultipleTextEmails(
    POLIS_FROM_ADDRESS,
    admin_emails,
    subject,
    body
  ).catch(function (err: any) {
    Log.yell("polis_err_failed_to_email_team");
    // Cannot find name 'message'. Did you mean 'onmessage'?ts(2552)
    //     lib.dom.d.ts(20013, 13): 'onmessage' is declared here.
    // @ts-ignore
    Log.yell(message);
  });
}

function getTwitterRequestToken(returnUrl: string) {
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
  let body = {
    oauth_callback: returnUrl,
  };
  return new Promise(function (
    resolve: (arg0: any) => void,
    reject: (arg0: any) => void
  ) {
    oauth.post(
      "https://api.twitter.com/oauth/request_token",
      // Argument of type 'undefined' is not assignable to parameter of type 'string'.ts(2345)
      // @ts-ignore
      void 0, //'your user token for this app', //test user token
      void 0, //'your user secret for this app', //test user secret
      body,
      "multipart/form-data",
      function (e: any, data: any, res: any) {
        if (e) {
          console.error("get twitter token failed");
          console.error(e);
          reject(e);
        } else {
          resolve(data);
        }
        // console.log("info",require('util').inspect(data));
      }
    );
  });
}

function getTwitterAccessToken(body: {
  oauth_verifier: any;
  oauth_token: any;
}) {
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
      "https://api.twitter.com/oauth/access_token",
      // Argument of type 'undefined' is not assignable to parameter of type 'string'.ts(2345)
      // @ts-ignore
      void 0, //'your user token for this app', //test user token
      void 0, //'your user secret for this app', //test user secret
      body,
      "multipart/form-data",
      function (e: any, data: any, res: any) {
        if (e) {
          console.error("get twitter token failed");
          console.error(e);
          reject(e);
        } else {
          resolve(data);
        }
        // console.log("info",require('util').inspect(data));
      }
    );
  });
}

// retry, resolving with first success, or rejecting with final error
function retryFunctionWithPromise(
  f: { (): any; (): Promise<any> },
  numTries: number
) {
  return new Promise(function (
    resolve: (arg0: any) => void,
    reject: (arg0: any) => void
  ) {
    console.log("info", "retryFunctionWithPromise", numTries);
    f().then(
      function (x: any) {
        console.log("info", "retryFunctionWithPromise", "RESOLVED");
        resolve(x);
      },
      function (err: any) {
        numTries -= 1;
        if (numTries <= 0) {
          console.log("info", "retryFunctionWithPromise", "REJECTED");
          reject(err);
        } else {
          retryFunctionWithPromise(f, numTries).then(resolve, reject);
        }
      }
    );
  });
}

function getTwitterUserInfo(
  o: { twitter_user_id: any; twitter_screen_name?: any },
  useCache: boolean
) {
  console.log("getTwitterUserInfo", o);

  let twitter_user_id = o.twitter_user_id;
  let twitter_screen_name = o.twitter_screen_name;
  let params: TwitterParameters = {
    // oauth_verifier: req.p.oauth_verifier,
    // oauth_token: req.p.oauth_token, // confused. needed, but docs say this: "The request token is also passed in the oauth_token portion of the header, but this will have been added by the signing process."
  };
  let identifier: string; // this is way sloppy, but should be ok for caching and logging
  if (twitter_user_id) {
    params.user_id = twitter_user_id;
    identifier = twitter_user_id;
  } else if (twitter_screen_name) {
    params.screen_name = twitter_screen_name;
    identifier = twitter_screen_name;
  }

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

  // 'new' expression, whose target lacks a construct signature, implicitly has an 'any' type.ts(7009)
  // @ts-ignore
  return new MPromise("getTwitterUserInfo", function (
    resolve: (arg0: any) => void,
    reject: (arg0?: undefined) => void
  ) {
    let cachedCopy = twitterUserInfoCache.get(identifier);
    if (useCache && cachedCopy) {
      return resolve(cachedCopy);
    }
    if (suspendedOrPotentiallyProblematicTwitterIds.indexOf(identifier) >= 0) {
      return reject();
    }
    oauth.post(
      "https://api.twitter.com/1.1/users/lookup.json",
      // Argument of type 'undefined' is not assignable to parameter of type 'string'.ts(2345)
      // @ts-ignore
      void 0, //'your user token for this app', //test user token
      void 0, //'your user secret for this app', //test user secret
      params,
      "multipart/form-data",
      function (e: any, data: any, res: any) {
        if (e) {
          console.error(
            "get twitter token failed for identifier: " + identifier
          );
          console.error(e);
          suspendedOrPotentiallyProblematicTwitterIds.push(identifier);
          reject(e);
        } else {
          twitterUserInfoCache.set(identifier, data);
          resolve(data);
        }
      }
    );
  });
}

function switchToUser(req: any, res: any, uid?: any) {
  return new Promise(function (
    resolve: () => void,
    reject: (arg0: string) => void
  ) {
    Session.startSession(uid, function (errSess: any, token: any) {
      if (errSess) {
        reject(errSess);
        return;
      }
      cookies
        .addCookies(req, res, token, uid)
        .then(function () {
          resolve();
        })
        .catch(function (err: any) {
          reject("polis_err_adding_cookies");
        });
    });
  });
}

function getPidsForGid(zid: any, gid: number, math_tick: number) {
  return Promise.all([
    getPca(zid, math_tick),
    getBidIndexToPidMapping(zid, math_tick),
  ]).then(function (o: ParticipantOption[]) {
    if (!o[0] || !o[0].asPOJO) {
      return [];
    }
    o[0] = o[0].asPOJO;
    let clusters = o[0]["group-clusters"];
    let indexToBid = o[0]["base-clusters"].id; // index to bid
    let bidToIndex = [];
    for (let i = 0; i < indexToBid.length; i++) {
      bidToIndex[indexToBid[i]] = i;
    }
    let indexToPids = o[1].bidToPid; // actually index to [pid]
    let cluster = clusters[gid];
    if (!cluster) {
      return [];
    }
    let members = cluster.members; // bids
    let pids: any[] = [];
    for (var i = 0; i < members.length; i++) {
      let bid = members[i];
      let index = bidToIndex[bid];
      let morePids = indexToPids[index];
      Array.prototype.push.apply(pids, morePids);
    }
    pids = pids.map(function (x) {
      return parseInt(x);
    });
    pids.sort(function (a, b) {
      return a - b;
    });
    return pids;
  });
}

function getParticipantDemographicsForConversation(zid: any) {
  return dbPgQuery.queryP(
    "select * from demographic_data left join participants on participants.uid = demographic_data.uid where zid = ($1);",
    [zid]
  );
}

function getParticipantVotesForCommentsFlaggedWith_is_meta(zid: any) {
  return dbPgQuery.queryP(
    "select tid, pid, vote from votes_latest_unique where zid = ($1) and tid in (select tid from comments where zid = ($1) and is_meta = true)",
    [zid]
  );
}

function getLocationsForParticipants(zid: any) {
  return dbPgQuery.queryP_readOnly(
    "select * from participant_locations where zid = ($1);",
    [zid]
  );
}

function getSocialParticipantsForMod(
  zid: any,
  limit: any,
  mod: any,
  owner: any
) {
  let modClause = "";
  let params = [zid, limit, owner];
  if (!_.isUndefined(mod)) {
    modClause = " and mod = ($4)";
    params.push(mod);
  }

  let q =
    "with " +
    "p as (select uid, pid, mod from participants where zid = ($1) " +
    modClause +
    "), " + // and vote_count >= 1
    "final_set as (select * from p limit ($2)), " +
    "xids_subset as (select * from xids where owner = ($3) and x_profile_image_url is not null), " +
    "all_rows as (select " +
    "final_set.mod, " +
    "twitter_users.twitter_user_id as tw__twitter_user_id, " +
    "twitter_users.screen_name as tw__screen_name, " +
    "twitter_users.name as tw__name, " +
    "twitter_users.followers_count as tw__followers_count, " +
    "twitter_users.verified as tw__verified, " +
    "twitter_users.profile_image_url_https as tw__profile_image_url_https, " +
    "twitter_users.location as tw__location, " +
    "facebook_users.fb_user_id as fb__fb_user_id, " +
    "facebook_users.fb_name as fb__fb_name, " +
    "facebook_users.fb_link as fb__fb_link, " +
    "facebook_users.fb_public_profile as fb__fb_public_profile, " +
    "facebook_users.location as fb__location, " +
    "xids_subset.x_profile_image_url as x_profile_image_url, " +
    "xids_subset.xid as xid, " +
    "xids_subset.x_name as x_name, " +
    "final_set.pid " +
    "from final_set " +
    "left join twitter_users on final_set.uid = twitter_users.uid " +
    "left join facebook_users on final_set.uid = facebook_users.uid " +
    "left join xids_subset on final_set.uid = xids_subset.uid " +
    ") " +
    "select * from all_rows where (tw__twitter_user_id is not null) or (fb__fb_user_id is not null) or (xid is not null) " +
    ";";
  return dbPgQuery.queryP(q, params);
}

function getSocialParticipantsForMod_timed(
  zid?: any,
  limit?: any,
  mod?: any,
  convOwner?: any
) {
  let start = Date.now();
  return getSocialParticipantsForMod
    .apply(null, [zid, limit, mod, convOwner])
    .then(function (results: any) {
      let elapsed = Date.now() - start;
      console.log("getSocialParticipantsForMod_timed", elapsed);
      return results;
    });
}

function pullXInfoIntoSubObjects(ptptoiRecord: any) {
  let p = ptptoiRecord;
  if (p.x_profile_image_url || p.xid || p.x_email) {
    p.xInfo = {};
    p.xInfo.x_profile_image_url = p.x_profile_image_url;
    p.xInfo.xid = p.xid;
    p.xInfo.x_name = p.x_name;
    // p.xInfo.x_email = p.x_email;
    delete p.x_profile_image_url;
    delete p.xid;
    delete p.x_name;
    delete p.x_email;
  }
  return p;
}

function removeNullOrUndefinedProperties(o: { [x: string]: any }) {
  for (var k in o) {
    let v = o[k];
    if (v === null || v === undefined) {
      delete o[k];
    }
  }
  return o;
}

function pullFbTwIntoSubObjects(ptptoiRecord: any) {
  let p = ptptoiRecord;
  let x: ParticipantSocialNetworkInfo = {};
  _.each(p, function (val: null, key: string) {
    let fbMatch = /fb__(.*)/.exec(key);
    let twMatch = /tw__(.*)/.exec(key);
    if (fbMatch && fbMatch.length === 2 && val !== null) {
      x.facebook = x.facebook || {};
      x.facebook[fbMatch[1]] = val;
    } else if (twMatch && twMatch.length === 2 && val !== null) {
      x.twitter = x.twitter || {};
      x.twitter[twMatch[1]] = val;
    } else {
      x[key] = val;
    }
  });
  // extract props from fb_public_profile
  if (x.facebook && x.facebook.fb_public_profile) {
    try {
      let temp = JSON.parse(x.facebook.fb_public_profile);
      x.facebook.verified = temp.verified;
      // shouln't return this to client
      delete x.facebook.fb_public_profile;
    } catch (e) {
      console.error("error parsing JSON of fb_public_profile for uid: ", p.uid);
    }

    if (!_.isUndefined(x.facebook.fb_user_id)) {
      let width = 40;
      let height = 40;
      x.facebook.fb_picture =
        "https://graph.facebook.com/v2.2/" +
        x.facebook.fb_user_id +
        "/picture?width=" +
        width +
        "&height=" +
        height;
    }
  }
  return x;
}

function getSocialParticipants(
  zid: any,
  uid?: any,
  limit?: any,
  mod?: number,
  math_tick?: any,
  authorUids?: any[]
) {
  // NOTE ignoring authorUids as part of cacheKey for now, just because.
  let cacheKey = [zid, limit, mod, math_tick].join("_");
  if (socialParticipantsCache.get(cacheKey)) {
    return socialParticipantsCache.get(cacheKey);
  }

  const authorsQueryParts = (authorUids || []).map(function (authorUid?: any) {
    return "select " + Number(authorUid) + " as uid, 900 as priority";
  });
  let authorsQuery: string | null =
    "(" + authorsQueryParts.join(" union ") + ")";
  if (!authorUids || authorUids.length === 0) {
    authorsQuery = null;
  }

  let q =
    "with " +
    "p as (select uid, pid, mod from participants where zid = ($1) and vote_count >= 1), " +
    "xids_subset as (select * from xids where owner in (select org_id from conversations where zid = ($1)) and x_profile_image_url is not null), " +
    "xid_ptpts as (select p.uid, 100 as priority from p inner join xids_subset on xids_subset.uid = p.uid where p.mod >= ($4)), " +
    "twitter_ptpts as (select p.uid, 10 as priority from p inner join twitter_users  on twitter_users.uid  = p.uid where p.mod >= ($4)), " +
    "all_fb_users as (select p.uid,   9 as priority from p inner join facebook_users on facebook_users.uid = p.uid where p.mod >= ($4)), " +
    "self as (select CAST($2 as INTEGER) as uid, 1000 as priority), " +
    (authorsQuery ? "authors as " + authorsQuery + ", " : "") +
    "pptpts as (select prioritized_ptpts.uid, max(prioritized_ptpts.priority) as priority " +
    "from ( " +
    "select * from self " +
    (authorsQuery ? "union " + "select * from authors " : "") +
    "union " +
    "select * from twitter_ptpts " +
    "union " +
    "select * from all_fb_users " +
    "union " +
    "select * from xid_ptpts " +
    ") as prioritized_ptpts " +
    "inner join p on prioritized_ptpts.uid = p.uid " +
    "group by prioritized_ptpts.uid order by priority desc, prioritized_ptpts.uid asc), " +
    // force inclusion of participants with high mod values
    "mod_pptpts as (select asdfasdjfioasjdfoi.uid, max(asdfasdjfioasjdfoi.priority) as priority " +
    "from ( " +
    "select * from pptpts " +
    "union all " +
    "select uid, 999 as priority from p where mod >= 2) as asdfasdjfioasjdfoi " +
    "group by asdfasdjfioasjdfoi.uid order by priority desc, asdfasdjfioasjdfoi.uid asc), " +
    // without blocked
    "final_set as (select * from mod_pptpts " +
    "limit ($3) " +
    ") " + // in invisible_uids
    "select " +
    "final_set.priority, " +
    "twitter_users.twitter_user_id as tw__twitter_user_id, " +
    "twitter_users.screen_name as tw__screen_name, " +
    "twitter_users.name as tw__name, " +
    "twitter_users.followers_count as tw__followers_count, " +
    "twitter_users.verified as tw__verified, " +
    "twitter_users.location as tw__location, " +
    "facebook_users.fb_user_id as fb__fb_user_id, " +
    "facebook_users.fb_name as fb__fb_name, " +
    "facebook_users.fb_link as fb__fb_link, " +
    "facebook_users.fb_public_profile as fb__fb_public_profile, " +
    "facebook_users.location as fb__location, " +
    "xids_subset.x_profile_image_url as x_profile_image_url, " +
    "xids_subset.xid as xid, " +
    "xids_subset.x_name as x_name, " +
    "xids_subset.x_email as x_email, " +
    "p.pid " +
    "from final_set " +
    "left join twitter_users on final_set.uid = twitter_users.uid " +
    "left join facebook_users on final_set.uid = facebook_users.uid " +
    "left join xids_subset on final_set.uid = xids_subset.uid " +
    "left join p on final_set.uid = p.uid " +
    ";";

  return dbPgQuery
    .queryP_metered_readOnly("getSocialParticipants", q, [zid, uid, limit, mod])
    .then(function (response: any) {
      console.log("getSocialParticipants", response);
      socialParticipantsCache.set(cacheKey, response);
      return response;
    });
}

function getVotesForZidPidWithTimestampCheck(
  zid: string,
  pid: string,
  math_tick: number
) {
  let key = zid + "_" + pid;
  let cachedVotes = votesForZidPidCache.get(key);
  if (cachedVotes) {
    // Object is of type 'unknown'.ts(2571)
    // @ts-ignore
    let pair = cachedVotes.split(":");
    let cachedTime = Number(pair[0]);
    let votes = pair[1];
    if (cachedTime >= math_tick) {
      return votes;
    }
  }
  return null;
}

function getVotesForPids(zid: any, pids: any[]) {
  if (pids.length === 0) {
    return Promise.resolve([]);
  }
  return (
    dbPgQuery
      .queryP_readOnly(
        "select * from votes where zid = ($1) and pid in (" +
          pids.join(",") +
          ") order by pid, tid, created;",
        [zid]
      )
      //     Argument of type '(votesRows: string | any[]) => string | any[]' is not assignable to parameter of type '(value: unknown) => string | any[] | PromiseLike<string | any[]>'.
      // Types of parameters 'votesRows' and 'value' are incompatible.
      //   Type 'unknown' is not assignable to type 'string | any[]'.
      //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
      // @ts-ignore
      .then(function (votesRows: string | any[]) {
        for (var i = 0; i < votesRows.length; i++) {
          votesRows[i].weight = votesRows[i].weight / 32767;
        }
        return votesRows;
      })
  );
}

function createEmptyVoteVector(greatestTid: number) {
  let a = [];
  for (var i = 0; i <= greatestTid; i++) {
    a[i] = "u"; // (u)nseen
  }
  return a;
}

function aggregateVotesToPidVotesObj(votes: string | any[]) {
  let i = 0;
  let greatestTid = 0;
  for (i = 0; i < votes.length; i++) {
    if (votes[i].tid > greatestTid) {
      greatestTid = votes[i].tid;
    }
  }

  // use arrays or strings?
  let vectors = {}; // pid -> sparse array
  for (i = 0; i < votes.length; i++) {
    let v = votes[i];
    // set up a vector for the participant, if not there already

    // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
    // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
    // @ts-ignore
    vectors[v.pid] = vectors[v.pid] || createEmptyVoteVector(greatestTid);
    // assign a vote value at that location
    let vote = v.vote;
    if (Utils.polisTypes.reactions.push === vote) {
      // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
      // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
      // @ts-ignore
      vectors[v.pid][v.tid] = "d";
    } else if (Utils.polisTypes.reactions.pull === vote) {
      // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
      // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
      // @ts-ignore
      vectors[v.pid][v.tid] = "a";
    } else if (Utils.polisTypes.reactions.pass === vote) {
      // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
      // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
      // @ts-ignore
      vectors[v.pid][v.tid] = "p";
    } else {
      console.error("unknown vote value");
      // let it stay 'u'
    }
  }
  let vectors2: { [key: string]: any } = {};
  //   Argument of type '(val: any[], key: string) => void' is not assignable to parameter of type 'CollectionIterator<unknown, void, {}>'.
  // Types of parameters 'val' and 'element' are incompatible.
  //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
  // @ts-ignore
  _.each(vectors, function (val: any[], key: string) {
    vectors2[key] = val.join("");
  });
  return vectors2;
}

function cacheVotesForZidPidWithTimestamp(
  zid: string,
  pid: string,
  math_tick: string,
  votes: string
) {
  let key = zid + "_" + pid;
  let val = math_tick + ":" + votes;
  votesForZidPidCache.set(key, val);
}
// returns {pid -> "adadddadpupuuuuuuuu"}

function getVotesForZidPidsWithTimestampCheck(
  zid: any,
  pids: any[],
  math_tick: any
) {
  let cachedVotes = pids.map(function (pid: any) {
    return {
      pid: pid,
      votes: getVotesForZidPidWithTimestampCheck(zid, pid, math_tick),
    };
  });
  let uncachedPids = cachedVotes
    .filter(function (o: { votes: any }) {
      return !o.votes;
    })
    .map(function (o: { pid: any }) {
      return o.pid;
    });
  cachedVotes = cachedVotes.filter(function (o: { votes: any }) {
    return !!o.votes;
  });

  function toObj(items: string | any[]) {
    let o = {};
    for (var i = 0; i < items.length; i++) {
      // Element implicitly has an 'any' type because expression of type 'string | number' can't be used to index type '{}'.
      // No index signature with a parameter of type 'string' was found on type '{}'.ts(7053)
      // @ts-ignore
      o[items[i].pid] = items[i].votes;
    }
    return o;
  }

  if (uncachedPids.length === 0) {
    return Promise.resolve(toObj(cachedVotes));
  }
  return getVotesForPids(zid, uncachedPids).then(function (votesRows: any) {
    let newPidToVotes = aggregateVotesToPidVotesObj(votesRows);
    _.each(newPidToVotes, function (votes: any, pid: any) {
      cacheVotesForZidPidWithTimestamp(zid, pid, math_tick, votes);
    });
    let cachedPidToVotes = toObj(cachedVotes);
    return Object.assign(newPidToVotes, cachedPidToVotes);
  });
}

function getBidsForPids(zid: any, math_tick: number, pids: any[]) {
  let dataPromise = getBidIndexToPidMapping(zid, math_tick);
  let mathResultsPromise = getPca(zid, math_tick);

  return Promise.all([dataPromise, mathResultsPromise]).then(function (
    items: { asPOJO: any }[]
  ) {
    // Property 'bidToPid' does not exist on type '{ asPOJO: any; }'.ts(2339)
    // @ts-ignore
    let b2p = items[0].bidToPid || []; // not sure yet if "|| []" is right here.
    let mathResults = items[1].asPOJO;
    function findBidForPid(pid: any) {
      let yourBidi = -1;
      // if (!b2p) {
      //     return yourBidi;
      // }
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
      return yourBid;
    }

    let indexToBid = mathResults["base-clusters"].id;
    let bids = pids.map(findBidForPid);
    let pidToBid = _.object(pids, bids);
    return pidToBid;
  });
}

function doFamousQuery(
  o?: { uid?: any; zid: any; math_tick: any; ptptoiLimit: any },
  req?: any
) {
  let uid = o?.uid;
  let zid = o?.zid;
  let math_tick = o?.math_tick;

  // NOTE: if this API is running slow, it's probably because fetching the PCA from pg is slow, and PCA caching is disabled

  let hardLimit = _.isUndefined(o?.ptptoiLimit) ? 30 : o?.ptptoiLimit;
  let mod = 0; // for now, assume all conversations will show unmoderated and approved participants.

  function getAuthorUidsOfFeaturedComments() {
    return getPca(zid, 0).then(function (pcaData: {
      asPOJO: any;
      consensus: { agree?: any; disagree?: any };
      repness: { [x: string]: any };
    }) {
      if (!pcaData) {
        return [];
      }
      pcaData = pcaData.asPOJO;
      pcaData.consensus = pcaData.consensus || {};
      pcaData.consensus.agree = pcaData.consensus.agree || [];
      pcaData.consensus.disagree = pcaData.consensus.disagree || [];
      let consensusTids = _.union(
        _.pluck(pcaData.consensus.agree, "tid"),
        _.pluck(pcaData.consensus.disagree, "tid")
      );

      let groupTids: never[] = [];
      for (var gid in pcaData.repness) {
        let commentData = pcaData.repness[gid];
        // Type 'any[]' is not assignable to type 'never[]'.
        // Type 'any' is not assignable to type 'never'.ts(2322)
        // @ts-ignore
        groupTids = _.union(groupTids, _.pluck(commentData, "tid"));
      }
      let featuredTids = _.union(consensusTids, groupTids);
      featuredTids.sort();
      featuredTids = _.uniq(featuredTids);

      if (featuredTids.length === 0) {
        return [];
      }
      let q =
        "with " +
        "authors as (select distinct(uid) from comments where zid = ($1) and tid in (" +
        featuredTids.join(",") +
        ") order by uid) " +
        "select authors.uid from authors inner join facebook_users on facebook_users.uid = authors.uid " +
        "union " +
        "select authors.uid from authors inner join twitter_users on twitter_users.uid = authors.uid " +
        "union " +
        "select authors.uid from authors inner join xids on xids.uid = authors.uid " +
        "order by uid;";

      return dbPgQuery.queryP_readOnly(q, [zid]).then(function (comments: any) {
        let uids = _.pluck(comments, "uid");
        console.log("famous uids", uids);

        uids = _.uniq(uids);
        return uids;
      });
    });
  }
  return Promise.all([
    Conversation.getConversationInfo(zid),
    getAuthorUidsOfFeaturedComments(),
  ]).then(function (a: any[]) {
    let conv = a[0];
    let authorUids = a[1];

    if (conv.is_anon) {
      return {};
    }

    return Promise.all([
      getSocialParticipants(zid, uid, hardLimit, mod, math_tick, authorUids),
    ]).then(function (stuff: never[][]) {
      let participantsWithSocialInfo: any[] = stuff[0] || [];
      participantsWithSocialInfo = participantsWithSocialInfo.map(function (p: {
        priority: number;
      }) {
        let x = pullXInfoIntoSubObjects(p);
        // nest the fb and tw properties in sub objects
        x = pullFbTwIntoSubObjects(x);

        if (p.priority === 1000) {
          x.isSelf = true;
        }
        if (x.twitter) {
          x.twitter.profile_image_url_https =
            Config.getServerNameWithProtocol(req) +
            "/twitter_image?id=" +
            x.twitter.twitter_user_id;
        }
        return x;
      });

      let pids = participantsWithSocialInfo.map(function (p: { pid: any }) {
        return p.pid;
      });
      console.log("mike1234", pids.length);

      let pidToData = _.indexBy(participantsWithSocialInfo, "pid"); // TODO this is extra work, probably not needed after some rethinking
      console.log("mike12345", pidToData);

      pids.sort(function (a: number, b: number) {
        return a - b;
      });
      pids = _.uniq(pids, true);

      console.log("mike12346", pids);

      return getVotesForZidPidsWithTimestampCheck(zid, pids, math_tick).then(
        function (vectors: any) {
          // TODO parallelize with above query
          return getBidsForPids(zid, -1, pids).then(
            function (pidsToBids: { [x: string]: any }) {
              _.each(
                vectors,
                function (value: any, pid: string | number, list: any) {
                  pid = parseInt(pid as string);
                  let bid = pidsToBids[pid];
                  let notInBucket = _.isUndefined(bid);
                  let isSelf = pidToData[pid].isSelf;
                  // console.log("info","pidToData", pid, myPid, isSelf);
                  // console.log("info",pidToData[pid]);
                  if (notInBucket && !isSelf) {
                    // pidToData[pid].ignore = true;
                    console.log("mike12347", "deleting", pid);
                    delete pidToData[pid]; // if the participant isn't in a bucket, they probably haven't voted enough for the math worker to bucketize them.
                  } else if (!!pidToData[pid]) {
                    console.log("mike12348", "keeping", pid);
                    pidToData[pid].votes = value; // no separator, like this "adupuuauuauupuuu";
                    pidToData[pid].bid = bid;
                  }
                }
              );
              return pidToData;
            },
            function (err: any) {
              // looks like there is no pca yet, so nothing to return.
              return {};
            }
          );
        }
      );
    });
  });
} // end doFamousQuery

function postMessageUsingHttp(o: {
  channel: any;
  team?: any;
  text: any;
  attachments?: {
    text: number;
    fallback: string;
    callback_id: string;
    color: string;
    attachment_type: string;
    actions: (
      | { name: string; text: string; type: string; value: string }
      | {
          name: string;
          text: string;
          style: string;
          type: string;
          value: string;
          confirm: {
            title: string;
            text: string;
            ok_text: string;
            dismiss_text: string;
          };
        }
    )[];
  }[];
}) {
  return new Promise(function (
    resolve: (arg0: any) => void,
    reject: (arg0: any) => void
  ) {
    web.chat.postMessage(o.channel, o.text, o, (err: any, info: any) => {
      if (err) {
        reject(err);
      } else {
        resolve(info);
      }
    });
  });
}

function sendEinviteEmail(req: any, email: any, einvite: any) {
  let serverName = Config.getServerNameWithProtocol(req);
  const body = `Welcome to pol.is!

Click this link to open your account:

${serverName}/welcome/${einvite}

Thank you for using Polis`;

  return emailSenders.sendTextEmail(
    POLIS_FROM_ADDRESS,
    email,
    "Get Started with Polis",
    body
  );
}

function doSendEinvite(req: any, email: any) {
  return Password.generateTokenP(30, false).then(function (einvite: any) {
    return dbPgQuery
      .queryP("insert into einvites (email, einvite) values ($1, $2);", [
        email,
        einvite,
      ])
      .then(function (rows: any) {
        return sendEinviteEmail(req, email, einvite);
      });
  });
}

function renderLtiLinkagePage(
  req: {
    p: UserType;
  },
  res: {
    set: (arg0: { "Content-Type": string }) => void;
    status: (arg0: number) => {
      (): any;
      new (): any;
      send: { (arg0: string): void; new (): any };
    };
  },
  afterJoinRedirectUrl?: string
) {
  let context_id = req.p.context_id;
  let user_id = req.p.user_id;
  let user_image = req.p.user_image;
  let tool_consumer_instance_guid = req.p.tool_consumer_instance_guid;

  let greeting = "";
  // TODO If we're doing this basic form, we can't just return json from the /login call

  let form1 =
    "" +
    '<h2>create a new <img src="https://pol.is/polis-favicon_favicon.png" height="20px"> pol<span class="Logo--blue">.</span>is account</h2>' +
    '<p><form role="form" class="FormVertical" action="' +
    Config.getServerNameWithProtocol(req) +
    '/api/v3/auth/new" method="POST">' +
    '<div class="FormVertical-group">' +
    '<label class="FormLabel" for="gatekeeperLoginEmail">Email</label>' +
    '<input type="text" id="email" name="email" id="gatekeeperLoginEmail" style="width: 100%;"  class="FormControl" value="' +
    (req.p.lis_person_contact_email_primary || "") +
    '">' +
    "</div>" +
    '<label class="FormLabel" for="gatekeeperLoginName">Full Name</label>' +
    '<input type="text" id="hname" name="hname" id="gatekeeperLoginName" style="width: 100%;"  class="FormControl" value="' +
    (req.p.lis_person_name_full || "") +
    '">' +
    '<div class="FormVertical-group">' +
    '<label class="FormLabel" for="gatekeeperLoginPassword">' +
    "Password" +
    "</label>" +
    '<input type="password" id="password" name="password" style="width: 100%;" id="gatekeeperLoginPassword" class="FormControl">' +
    "<div>" +
    '<label class="FormLabel" for="gatekeeperLoginPassword2">' +
    "Repeat Password" +
    "</label>" +
    '<input type="password" id="password2" name="password2" style="width: 100%;" id="gatekeeperLoginPassword2" class="FormControl">' +
    "</div>" +
    '<input type="hidden" name="lti_user_id" value="' +
    user_id +
    '">' +
    '<input type="hidden" name="lti_user_image" value="' +
    user_image +
    '">' +
    '<input type="hidden" name="lti_context_id" value="' +
    context_id +
    '">' +
    '<input type="hidden" name="tool_consumer_instance_guid" value="' +
    tool_consumer_instance_guid +
    '">' +
    '<input type="hidden" name="afterJoinRedirectUrl" value="' +
    afterJoinRedirectUrl +
    '">' +
    "</div>" +
    '<input type="checkbox" name="gatekeeperTosPrivacy" id="gatekeeperTosPrivacy" style="position: relative; top: -1px"> &nbsp; By signing up, you agree to our <a href="' +
    Config.get('TERMS_OF_SERVICE_URL') +
    '"> terms of use</a> and <a href="'
    Config.get('PRIVACY_URL') +
    '"> privacy policy </a>' +
    '<div class="row" id="errorDiv"></div>' +
    '<div class="FormVertical-group">' +
    '<button type="submit" class="Btn Btn-primary">Create new pol.is account</button>' +
    "</div>" +
    "</form></p>";

  let form2 =
    "" +
    "<p> - OR - </p>" +
    "<h2>sign in with an existing pol.is account</h2>" +
    '<p><form role="form" class="FormVertical" action="' +
    Config.getServerNameWithProtocol(req) +
    '/api/v3/auth/login" method="POST">' +
    '<div class="FormVertical-group">' +
    '<label class="FormLabel" for="gatekeeperLoginEmail">Email</label>' +
    '<input type="text" id="email" name="email" id="gatekeeperLoginEmail" style="width: 100%;" class="FormControl">' +
    "</div>" +
    '<div class="FormVertical-group">' +
    '<label class="FormLabel" for="gatekeeperLoginPassword">' +
    "Password" +
    "</label>" +
    '<input type="password" id="password" name="password" id="gatekeeperLoginPassword" style="width: 100%;" class="FormControl">' +
    '<input type="hidden" name="lti_user_id" value="' +
    user_id +
    '">' +
    '<input type="hidden" name="lti_user_image" value="' +
    user_image +
    '">' +
    '<input type="hidden" name="lti_context_id" value="' +
    context_id +
    '">' +
    '<input type="hidden" name="tool_consumer_instance_guid" value="' +
    tool_consumer_instance_guid +
    '">' +
    '<input type="hidden" name="afterJoinRedirectUrl" value="' +
    afterJoinRedirectUrl +
    '">' +
    '<a href="/pwresetinit" class="FormLink">Forgot your password?</a>' +
    "</div>" +
    "" +
    '<div class="row" id="errorDiv"></div>' +
    '<div class="FormVertical-group">' +
    '<button type="submit" class="Btn Btn-primary">Sign In</button>' +
    "</div>" +
    "</form></p>";
  res.set({
    "Content-Type": "text/html",
  });
  // let customPart = isInstructor ? "you are the instructor" : "you are a Student";

  let html =
    "" +
    "<!DOCTYPE html><html lang='en'>" +
    "<head>" +
    '<meta name="viewport" content="width=device-width, initial-scale=1;">' +
    "</head>" +
    "<body style='max-width:320px; font-family: Futura, Helvetica, sans-serif;'>" +
    greeting +
    form1 +
    form2 +
    // " <p style='background-color: Log.yellow;'>" +
    //     JSON.stringify(req.body)+
    //     "<img src='"+req.p.user_image+"'></img>"+
    // "</p>"+
    "</body></html>";

  res.status(200).send(html);
}
// team meetings - schedule with others, smart converence room
// or redirect tool
// students already pay an online fee

// ADA? 508 compliance
// accessibility - Teach Act: those who don't have dexterity
// colors
// screen readers
/*
2014-09-21T23:16:15.351247+00:00 app[web.1]: course_setup
2014-09-21T23:16:15.188414+00:00 app[web.1]: { oauth_consumer_key: 'asdfasdf',
2014-09-21T23:16:15.188418+00:00 app[web.1]:   oauth_signature_method: 'HMAC-SHA1',
2014-09-21T23:16:15.188420+00:00 app[web.1]:   oauth_timestamp: '1411341372',
2014-09-21T23:16:15.188422+00:00 app[web.1]:   oauth_nonce: 'JHnE7tcVBHYx9MjLcQS2jWNTGCD56F5wqwePk4tnk',
2014-09-21T23:16:15.188423+00:00 app[web.1]:   oauth_version: '1.0',
2014-09-21T23:16:15.188425+00:00 app[web.1]:   context_id: '543f4cb8ba0ad2939faa5b2643cb1415d3ada3c5',
2014-09-21T23:16:15.188426+00:00 app[web.1]:   context_label: 'polis_demo_course_code',
2014-09-21T23:16:15.188428+00:00 app[web.1]:   context_title: 'polis demo course',
2014-09-21T23:16:15.188430+00:00 app[web.1]:   custom_canvas_enrollment_state: 'active',
2014-09-21T23:16:15.188432+00:00 app[web.1]:   custom_canvas_xapi_url: 'https://canvas.instructure.com/api/lti/v1/tools/46849/xapi',
2014-09-21T23:16:15.188433+00:00 app[web.1]:   launch_presentation_document_target: 'iframe',
2014-09-21T23:16:15.188435+00:00 app[web.1]:   launch_presentation_height: '400',
2014-09-21T23:16:15.188436+00:00 app[web.1]:   launch_presentation_locale: 'en',
2014-09-21T23:16:15.188437+00:00 app[web.1]:   launch_presentation_return_url: 'https://canvas.instructure.com/courses/875179',
2014-09-21T23:16:15.188439+00:00 app[web.1]:   launch_presentation_width: '800',
2014-09-21T23:16:15.188441+00:00 app[web.1]:   lti_message_type: 'basic-lti-launch-request',
2014-09-21T23:16:15.188442+00:00 app[web.1]:   lti_version: 'LTI-1p0',
2014-09-21T23:16:15.188443+00:00 app[web.1]:   oauth_callback: 'about:blank',
2014-09-21T23:16:15.188445+00:00 app[web.1]:   resource_link_id: '543f4cb8ba0ad2939faa5b2643cb1415d3ada3c5',
2014-09-21T23:16:15.188447+00:00 app[web.1]:   resource_link_title: 'polis nav',
2014-09-21T23:16:15.188448+00:00 app[web.1]:   roles: 'Instructor',
2014-09-21T23:16:15.188450+00:00 app[web.1]:   tool_consumer_info_product_family_code: 'canvas',
2014-09-21T23:16:15.188451+00:00 app[web.1]:   tool_consumer_info_version: 'cloud',
2014-09-21T23:16:15.188453+00:00 app[web.1]:   tool_consumer_instance_contact_email: 'notifications@instructure.com',
2014-09-21T23:16:15.188454+00:00 app[web.1]:   tool_consumer_instance_guid: '07adb3e60637ff02d9ea11c7c74f1ca921699bd7.canvas.instructure.com',
2014-09-21T23:16:15.188456+00:00 app[web.1]:   tool_consumer_instance_name: 'Free For Teachers',
2014-09-21T23:16:15.188457+00:00 app[web.1]:   user_id: '15bbe33bd1cf5355011a9ce6ebe1072256beea01',
2014-09-21T23:16:15.188459+00:00 app[web.1]:   user_image: 'https://secure.gravatar.com/avatar/256caee7b9886c54155ef0d316dffabc?s=50&d=https%3A%2F%2Fcanvas.instructure.com%2Fimages%2Fmessages%2Favatar-50.png',
2014-09-21T23:16:15.188461+00:00 app[web.1]:   oauth_signature: 'jJ3TbKvalDUYvELXNvnzOfdCwGo=' }
*/
// A compromise would be this:
// Instructors see a custom inbox for the course, and can create conversations there. make it easy to copy and paste links..
// how do we deal with sections? can't do this.
// Conversations created here will be under the uid of the account owner... which may be problematic later with school-wide accounts... if we ever offer that
//
// Complication: sections -- are they needed this quarter? maybe better to just do the linkage, and then try to make it easy to post the stuff...
//  it is possible for teachers to create a duplicate assignment, and have it show for certain sections...
//     so we can rely on custom_canvas_assignment_id

function getCanvasAssignmentConversationCallbackParams(
  lti_user_id: any,
  lti_context_id: any,
  custom_canvas_assignment_id: any,
  tool_consumer_instance_guid?: any
) {
  return dbPgQuery.queryP(
    "select * from canvas_assignment_callback_info where lti_user_id = ($1) and lti_context_id = ($2) and custom_canvas_assignment_id = ($3) and tool_consumer_instance_guid = ($4);",
    [
      lti_user_id,
      lti_context_id,
      custom_canvas_assignment_id,
      tool_consumer_instance_guid,
    ]
  );
}

function addCanvasAssignmentConversationCallbackParamsIfNeeded(
  lti_user_id: any,
  lti_context_id: any,
  custom_canvas_assignment_id: any,
  tool_consumer_instance_guid?: any,
  lis_outcome_service_url?: any,
  lis_result_sourcedid?: any,
  stringified_json_of_post_content?: string
) {
  return (
    getCanvasAssignmentConversationCallbackParams(
      lti_user_id,
      lti_context_id,
      custom_canvas_assignment_id,
      tool_consumer_instance_guid
    )
      //     Argument of type '(rows: string | any[]) => Promise<unknown>' is not assignable to parameter of type '(value: unknown) => unknown'.
      // Types of parameters 'rows' and 'value' are incompatible.
      //   Type 'unknown' is not assignable to type 'string | any[]'.
      //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
      // @ts-ignore
      .then(function (rows: string | any[]) {
        if (rows && rows.length) {
          // update
          // this is failing, but it has been ok, since the insert worked (i assume)
          return dbPgQuery.queryP(
            "update canvas_assignment_callback_info set lis_outcome_service_url = ($5), lis_result_sourcedid = ($6), stringified_json_of_post_content = ($7) where lti_user_id = ($1) and lti_context_id = ($2) and custom_canvas_assignment_id = ($3) and tool_consumer_instance_guid = ($4);",
            [
              lti_user_id,
              lti_context_id,
              custom_canvas_assignment_id,
              tool_consumer_instance_guid,
              lis_outcome_service_url,
              lis_result_sourcedid,
              stringified_json_of_post_content,
            ]
          );
        } else {
          // insert
          return dbPgQuery.queryP(
            "insert into canvas_assignment_callback_info (lti_user_id, lti_context_id, custom_canvas_assignment_id, tool_consumer_instance_guid, lis_outcome_service_url, lis_result_sourcedid, stringified_json_of_post_content) values ($1, $2, $3, $4, $5, $6, $7);",
            [
              lti_user_id,
              lti_context_id,
              custom_canvas_assignment_id,
              tool_consumer_instance_guid,
              lis_outcome_service_url,
              lis_result_sourcedid,
              stringified_json_of_post_content,
            ]
          );
        }
      })
  );
}

function getZinvite(zid: any, dontUseCache?: boolean) {
  let cachedConversationId = zidToConversationIdCache.get(zid);
  if (!dontUseCache && cachedConversationId) {
    return Promise.resolve(cachedConversationId);
  }
  return dbPgQuery
    .queryP_metered("getZinvite", "select * from zinvites where zid = ($1);", [
      zid,
    ])
    .then(function (rows: { zinvite: any }[]) {
      let conversation_id = (rows && rows[0] && rows[0].zinvite) || void 0;
      if (conversation_id) {
        zidToConversationIdCache.set(zid, conversation_id);
      }
      return conversation_id;
    });
}

function encodeParams(o: {
  monthly?: any;
  forceEmbedded?: boolean;
  xPolisLti?: any;
  tool_consumer_instance_guid?: any;
  context?: any;
  custom_canvas_assignment_id?: any;
}) {
  let stringifiedJson = JSON.stringify(o);
  let encoded = "ep1_" + Utils.strToHex(stringifiedJson);
  return encoded;
}

function getCanvasAssignmentInfo(
  tool_consumer_instance_guid: string,
  lti_context_id: string,
  custom_canvas_assignment_id: string
) {
  console.log(
    "info",
    "grades select * from canvas_assignment_conversation_info where tool_consumer_instance_guid = " +
      tool_consumer_instance_guid +
      " and lti_context_id = " +
      lti_context_id +
      " and custom_canvas_assignment_id = " +
      custom_canvas_assignment_id +
      ";"
  );
  return dbPgQuery.queryP(
    "select * from canvas_assignment_conversation_info where tool_consumer_instance_guid = ($1) and lti_context_id = ($2) and custom_canvas_assignment_id = ($3);",
    [tool_consumer_instance_guid, lti_context_id, custom_canvas_assignment_id]
  );
}

function hasWhitelistMatches(host: string) {
  let hostWithoutProtocol = host;
  if (host.startsWith("http://")) {
    hostWithoutProtocol = host.slice(7);
  } else if (host.startsWith("https://")) {
    hostWithoutProtocol = host.slice(8);
  }

  for (let i = 0; i < whitelistedDomains.length; i++) {
    let w = whitelistedDomains[i];
    if (hostWithoutProtocol.endsWith(w || "")) {
      // ok, the ending matches, now we need to make sure it's the same, or a subdomain.
      if (hostWithoutProtocol === w) {
        return true;
      }
      if (
        hostWithoutProtocol[
          hostWithoutProtocol.length - ((w || "").length + 1)
        ] === "."
      ) {
        // separated by a dot, so it's a subdomain.
        return true;
      }
    }
  }
  return false;
}

function buildStaticHostname(req: { headers?: { host: string } }, res: any) {
  if (devMode || Config.domainOverride) {
    return process.env.STATIC_FILES_HOST;
  } else {
    let origin = req?.headers?.host;
    // Element implicitly has an 'any' type because expression of type 'string' can't be used to index type '{ "pol.is": string; "embed.pol.is": string; "survey.pol.is": string; "preprod.pol.is": string; }'.
    // No index signature with a parameter of type 'string' was found on type '{ "pol.is": string; "embed.pol.is": string; "survey.pol.is": string; "preprod.pol.is": string; }'.ts(7053)
    // @ts-ignore
    if (!whitelistedBuckets[origin || ""]) {
      if (hasWhitelistMatches(origin || "")) {
        // Use the prod bucket for non pol.is domains
        return (
          whitelistedBuckets["pol.is"] + "." + process.env.STATIC_FILES_HOST
        );
      } else {
        console.error(
          "got request with host that's not whitelisted: (" +
            req?.headers?.host +
            ")"
        );
        return;
      }
    }
    // Element implicitly has an 'any' type because expression of type 'string' can't be used to index type '{ "pol.is": string; "embed.pol.is": string; "survey.pol.is": string; "preprod.pol.is": string; }'.
    // No index signature with a parameter of type 'string' was found on type '{ "pol.is": string; "embed.pol.is": string; "survey.pol.is": string; "preprod.pol.is": string; }'.ts(7053)
    // @ts-ignore
    origin = whitelistedBuckets[origin || ""];
    return origin + "." + process.env.STATIC_FILES_HOST;
  }
}

function makeFileFetcher(
  hostname?: string,
  port?: string,
  path?: string,
  headers?: { "Content-Type": string },
  preloadData?: { conversation?: ConversationType }
) {
  return function (
    req: { headers?: { host: any }; path: any; pipe: (arg0: any) => void },
    res: { set: (arg0: any) => void }
  ) {
    let hostname = buildStaticHostname(req, res);
    if (!hostname) {
      Log.fail(res, 500, "polis_err_file_fetcher_serving_to_domain");
      console.error(req?.headers?.host);
      console.error(req.path);
      return;
    }
    // pol.is.s3-website-us-east-1.amazonaws.com
    // preprod.pol.is.s3-website-us-east-1.amazonaws.com

    // TODO https - buckets would need to be renamed to have dashes instead of dots.
    // http://stackoverflow.com/questions/3048236/amazon-s3-https-ssl-is-it-possible
    let url = "http://" + hostname + ":" + port + path;
    console.log("info", "fetch file from " + url);
    let x = request(url);
    req.pipe(x);
    if (!_.isUndefined(preloadData)) {
      x = x.pipe(
        replaceStream(
          '"REPLACE_THIS_WITH_PRELOAD_DATA"',
          JSON.stringify(preloadData)
        )
      );
    }

    let fbMetaTagsString =
      '<meta property="og:image" content="https://s3.amazonaws.com/pol.is/polis_logo.png" />\n';
    if (preloadData && preloadData.conversation) {
      fbMetaTagsString +=
        '    <meta property="og:title" content="' +
        preloadData.conversation.topic +
        '" />\n';
      fbMetaTagsString +=
        '    <meta property="og:description" content="' +
        preloadData.conversation.description +
        '" />\n';
      // fbMetaTagsString += "    <meta property=\"og:site_name\" content=\"" + site_name + "\" />\n";
    }
    x = x.pipe(
      replaceStream("<!-- REPLACE_THIS_WITH_FB_META_TAGS -->", fbMetaTagsString)
    );

    res.set(headers);

    // Argument of type '{ set: (arg0: any) => void; }' is not assignable to parameter of type 'WritableStream'.
    //   Type '{ set: (arg0: any) => void; }' is missing the following properties from type 'WritableStream': writable, write, end, addListener, and 14 more.ts(2345)
    // @ts-ignore
    x.pipe(res);
    x.on("error", function (err: any) {
      Log.fail(res, 500, "polis_err_finding_file " + path, err);
    });
  };
}

function generateConversationURLPrefix() {
  // not 1 or 0 since they look like "l" and "O"
  return "" + _.random(2, 9);
}

function generateSUZinvites(numTokens: number) {
  return new Promise(function (
    resolve: (arg0: any) => void,
    reject: (arg0: Error) => void
  ) {
    Password.generateToken(
      31 * numTokens,
      true, // For now, pseodorandom bytes are probably ok. Anticipating API call will generate lots of these at once, possibly draining the entropy pool. Revisit this if the otzinvites really need to be unguessable.
      function (err: any, longStringOfTokens?: string) {
        if (err) {
          reject(new Error("polis_err_creating_otzinvite"));
          return;
        }
        console.log("info", longStringOfTokens);
        let otzinviteArrayRegexMatch = longStringOfTokens?.match(/.{1,31}/g);
        let otzinviteArray = otzinviteArrayRegexMatch?.slice(0, numTokens); // Base64 encoding expands to extra characters, so trim to the number of tokens we want.
        otzinviteArray = otzinviteArray?.map(function (suzinvite: string) {
          return generateConversationURLPrefix() + suzinvite;
        });
        console.log("info", otzinviteArray);
        resolve(otzinviteArray);
      }
    );
  });
}

function sendSuzinviteEmail(
  req: any,
  email: any,
  conversation_id: string,
  suzinvite: string
) {
  let serverName = Config.getServerNameWithProtocol(req);
  let body =
    "" +
    "Welcome to pol.is!\n" +
    "\n" +
    "Click this link to open your account:\n" +
    "\n" +
    serverName +
    "/ot/" +
    conversation_id +
    "/" +
    suzinvite +
    "\n" +
    "\n" +
    "Thank you for using Polis\n";

  return emailSenders.sendTextEmail(
    POLIS_FROM_ADDRESS,
    email,
    "Join the pol.is conversation!",
    body
  );
}

function addInviter(inviter_uid?: any, invited_email?: any) {
  return dbPgQuery.queryP(
    "insert into inviters (inviter_uid, invited_email) VALUES ($1, $2);",
    [inviter_uid, invited_email]
  );
}

function doGetConversationPreloadInfo(conversation_id: any) {
  // return Promise.resolve({});
  return Conversation.getZidFromConversationId(conversation_id)
    .then(function (zid: any) {
      return Promise.all([Conversation.getConversationInfo(zid)]);
    })
    .then(function (a: any[]) {
      let conv = a[0];

      let auth_opt_allow_3rdparty = ifDefinedFirstElseSecond(
        conv.auth_opt_allow_3rdparty,
        constants.DEFAULTS.auth_opt_allow_3rdparty
      );
      let auth_opt_fb_computed =
        auth_opt_allow_3rdparty &&
        ifDefinedFirstElseSecond(
          conv.auth_opt_fb,
          constants.DEFAULTS.auth_opt_fb
        );
      let auth_opt_tw_computed =
        auth_opt_allow_3rdparty &&
        ifDefinedFirstElseSecond(
          conv.auth_opt_tw,
          constants.DEFAULTS.auth_opt_tw
        );

      conv = {
        topic: conv.topic,
        description: conv.description,
        created: conv.created,
        link_url: conv.link_url,
        parent_url: conv.parent_url,
        vis_type: conv.vis_type,
        write_type: conv.write_type,
        help_type: conv.help_type,
        socialbtn_type: conv.socialbtn_type,
        bgcolor: conv.bgcolor,
        help_color: conv.help_color,
        help_bgcolor: conv.help_bgcolor,
        style_btn: conv.style_btn,
        auth_needed_to_vote: ifDefinedFirstElseSecond(
          conv.auth_needed_to_vote,
          constants.DEFAULTS.auth_needed_to_vote
        ),
        auth_needed_to_write: ifDefinedFirstElseSecond(
          conv.auth_needed_to_write,
          constants.DEFAULTS.auth_needed_to_write
        ),
        auth_opt_allow_3rdparty: auth_opt_allow_3rdparty,
        auth_opt_fb_computed: auth_opt_fb_computed,
        auth_opt_tw_computed: auth_opt_tw_computed,
      };
      conv.conversation_id = conversation_id;
      // conv = Object.assign({}, optionalResults, conv);
      return conv;
    });
}

function registerPageId(site_id: any, page_id: any, zid: any) {
  return dbPgQuery.queryP(
    "insert into page_ids (site_id, page_id, zid) values ($1, $2, $3);",
    [site_id, page_id, zid]
  );
}

function initializeImplicitConversation(
  site_id: RegExpExecArray | null,
  page_id: RegExpExecArray | null,
  o: {}
) {
  // find the user with that site_id.. wow, that will be a big index..
  // I suppose we could duplicate the site_ids that actually have conversations
  // into a separate table, and search that first, only searching users if nothing is there.
  return (
    dbPgQuery
      .queryP_readOnly(
        "select uid from users where site_id = ($1) and site_owner = TRUE;",
        [site_id]
      )
      //     Argument of type '(rows: string | any[]) => Bluebird<{ owner: any; zid: any; zinvite: any; }>' is not assignable to parameter of type '(value: unknown) => { owner: any; zid: any; zinvite: any; } | PromiseLike<{ owner: any; zid: any; zinvite: any; }>'.
      // Types of parameters 'rows' and 'value' are incompatible.
      //   Type 'unknown' is not assignable to type 'string | any[]'.
      //     Type 'unknown' is not assignable to type 'any[]'.ts(2345)
      // @ts-ignore
      .then(function (rows: string | any[]) {
        if (!rows || !rows.length) {
          throw new Error("polis_err_bad_site_id");
        }
        return new Promise(function (
          resolve: (arg0: { owner: any; zid: any; zinvite: any }) => void,
          reject: (arg0: string, arg1?: undefined) => void
        ) {
          let uid = rows[0].uid;
          //    create a conversation for the owner we got,
          let generateShortUrl = false;

          isUserAllowedToCreateConversations(
            uid,
            function (err: any, isAllowed: any) {
              if (err) {
                reject(err);
                return;
              }
              if (!isAllowed) {
                reject(err);
                return;
              }

              let params = Object.assign(o, {
                owner: uid,
                org_id: uid,
                // description: req.p.description,
                is_active: true,
                is_draft: false,
                is_public: true, // TODO remove this column
                is_anon: false,
                profanity_filter: true, // TODO this could be drawn from config for the owner
                spam_filter: true, // TODO this could be drawn from config for the owner
                strict_moderation: false, // TODO this could be drawn from config for the owner
                // context: req.p.context,
                owner_sees_participation_stats: false, // TODO think, and test join
              });

              let q = SQL.sql_conversations
                .insert(params)
                .returning("*")
                .toString();

              dbPgQuery.query(
                q,
                [],
                function (err: any, result: { rows: { zid: any }[] }) {
                  if (err) {
                    if (isDuplicateKey(err)) {
                      Log.yell(err);
                      reject("polis_err_create_implicit_conv_duplicate_key");
                    } else {
                      reject("polis_err_create_implicit_conv_db");
                    }
                  }

                  let zid =
                    result &&
                    result.rows &&
                    result.rows[0] &&
                    result.rows[0].zid;

                  Promise.all([
                    registerPageId(site_id, page_id, zid),
                    CreateUser.generateAndRegisterZinvite(
                      zid,
                      generateShortUrl
                    ),
                  ])
                    .then(function (o: any[]) {
                      // let notNeeded = o[0];
                      let zinvite = o[1];
                      // NOTE: OK to return conversation_id, because this conversation was just created by this user.
                      resolve({
                        owner: uid,
                        zid: zid,
                        zinvite: zinvite,
                      });
                    })
                    .catch(function (err: any) {
                      reject("polis_err_zinvite_create_implicit", err);
                    });
                }
              ); // end insert
            }
          ); // end isUserAllowedToCreateConversations

          //    add a record to page_ids
          //    (put the site_id in the smaller site_ids table)
          //    redirect to the zinvite url for the conversation
        });
      })
  );
}

function buildConversationDemoUrl(req: any, zinvite: string) {
  return Config.getServerNameWithProtocol(req) + "/demo/" + zinvite;
}

function buildModerationUrl(req: any, zinvite: string) {
  return Config.getServerNameWithProtocol(req) + "/m/" + zinvite;
}

function buildSeedUrl(req: any, zinvite: any) {
  return buildModerationUrl(req, zinvite) + "/comments/seed";
}

function sendImplicitConversationCreatedEmails(
  site_id: string | RegExpExecArray | null,
  page_id: string | RegExpExecArray | null,
  url: string,
  modUrl: string,
  seedUrl: string
) {
  let body =
    "" +
    "Conversation created!" +
    "\n" +
    "\n" +
    "You can find the conversation here:\n" +
    url +
    "\n" +
    "You can moderate the conversation here:\n" +
    modUrl +
    "\n" +
    "\n" +
    'We recommend you add 2-3 short statements to start things off. These statements should be easy to agree or disagree with. Here are some examples:\n "I think the proposal is good"\n "This topic matters a lot"\n or "The bike shed should have a metal roof"\n\n' +
    "You can add statements here:\n" +
    seedUrl +
    "\n" +
    "\n" +
    "Feel free to reply to this email if you have questions." +
    "\n" +
    "\n" +
    "Additional info: \n" +
    'site_id: "' +
    site_id +
    '"\n' +
    'page_id: "' +
    page_id +
    '"\n' +
    "\n";

  return dbPgQuery
    .queryP("select email from users where site_id = ($1)", [site_id])
    .then(function (rows: any) {
      let emails = _.pluck(rows, "email");

      return sendMultipleTextEmails(
        POLIS_FROM_ADDRESS,
        emails,
        "Polis conversation created",
        body
      );
    });
}

function hasAuthToken(req: { cookies: { [x: string]: any } }) {
  return !!req.cookies[cookies.COOKIES.TOKEN];
}

function browserSupportsPushState(req: { headers?: { [x: string]: string } }) {
  return !/MSIE [23456789]/.test(req?.headers?.["user-agent"] || "");
}

// 'new' expression, whose target lacks a construct signature, implicitly has an 'any' type.ts(7009)
// @ts-ignore
let routingProxy = new httpProxy.createProxyServer();

function addStaticFileHeaders(res: {
  setHeader: (arg0: string, arg1: string | number) => void;
}) {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", 0);
}

function proxy(req: { headers?: { host: string }; path: any }, res: any) {
  let hostname = buildStaticHostname(req, res);
  if (!hostname) {
    let host = req?.headers?.host || "";
    let re = new RegExp(process.env.SERVICE_HOSTNAME + "$");
    if (host.match(re)) {
      // don't alert for this, it's probably DNS related
      // TODO_SEO what should we return?
      Log.userFail(
        res,
        500,
        "polis_err_proxy_serving_to_domain",
        new Error(host)
      );
    } else {
      Log.fail(res, 500, "polis_err_proxy_serving_to_domain", new Error(host));
    }
    console.error(req?.headers?.host);
    console.error(req.path);
    return;
  }

  if (devMode) {
    addStaticFileHeaders(res);
  }
  let port = process.env.STATIC_FILES_PORT;
  // set the host header too, since S3 will look at that (or the routing proxy will patch up the request.. not sure which)
  if (req && req.headers && req.headers.host) req.headers.host = hostname;
  routingProxy.web(req, res, {
    target: {
      host: hostname,
      port: port,
    },
  });
  // }
}

export {
  hasWhitelistMatches,
  processMathObject,
  isPolisDev,
  updatePcaCache,
  getPca,
  isModerator,
  hostname,
  portForParticipationFiles,
  doAddDataExportTask,
  getZidForRid,
  getBidIndexToPidMapping,
  isOwner,
  clearCookies,
  getUidByEmail,
  sendPasswordResetEmail,
  sendPasswordResetEmailFailure,
  hashStringToInt32,
  emailFeatureRequest,
  doGetConversationsRecent,
  clearCookie,
  updateLastInteractionTimeForConversation,
  userHasAnsweredZeQuestions,
  getAnswersForConversation,
  joinConversation,
  getParticipant,
  populateParticipantLocationRecordIfPossible,
  addExtendedParticipantInfo,
  verifyHmacForQueryParams,
  createNotificationsUnsubscribeUrl,
  subscribeToNotifications,
  unsubscribeFromNotifications,
  joinWithZidOrSuzinvite,
  recordPermanentCookieZidJoin,
  ifDefinedSet,
  getXids,
  createNotificationsSubscribeUrl,
  startSessionAndAddCookies,
  getDomainWhitelist,
  setDomainWhitelist,
  getFirstForPid,
  deleteFacebookUserRecord,
  emailBadProblemTime,
  getFriends,
  getLocationInfo,
  do_handle_POST_auth_facebook,
  getDemographicsForVotersOnComments,
  finishArray,
  prepForTwitterComment,
  prepForQuoteWithTwitterUser,
  isSpam,
  commentExists,
  hasBadWords,
  getNumberOfCommentsWithModerationStatus,
  sendCommentModerationEmail,
  addNotificationTask,
  votesPost,
  updateConversationModifiedTime,
  updateVoteCount,
  getVotesForSingleParticipant,
  getNextComment,
  finishOne,
  addParticipant,
  addParticipantAndMetadata,
  addStar,
  addNoMoreCommentsRecord,
  isDuplicateKey,
  moderateComment,
  sendCanvasGradesIfNeeded,
  suspendedOrPotentiallyProblematicTwitterIds,
  updateLocalRecordsToReflectPostedGrades,
  verifyMetadataAnswersExistForEachQuestion,
  generateAndReplaceZinvite,
  getConversationUrl,
  sendEmailByUid,
  addCanvasAssignmentConversationInfoIfNeeded,
  getZidForQuestion,
  isConversationOwner,
  deleteMetadataQuestionAndAnswers,
  getZidForAnswer,
  deleteMetadataAnswer,
  getChoicesForConversation,
  createReport,
  getOneConversation,
  getConversations,
  isUserAllowedToCreateConversations,
  failWithRetryRequest,
  buildConversationUrl,
  isOwnerOrParticipant,
  emailTeam,
  getTwitterRequestToken,
  getTwitterAccessToken,
  retryFunctionWithPromise,
  getTwitterUserInfo,
  switchToUser,
  getPidsForGid,
  getParticipantDemographicsForConversation,
  getParticipantVotesForCommentsFlaggedWith_is_meta,
  getLocationsForParticipants,
  getSocialParticipantsForMod_timed,
  pullXInfoIntoSubObjects,
  removeNullOrUndefinedProperties,
  pullFbTwIntoSubObjects,
  doFamousQuery,
  postMessageUsingHttp,
  doSendEinvite,
  renderLtiLinkagePage,
  addCanvasAssignmentConversationCallbackParamsIfNeeded,
  getZinvite,
  encodeParams,
  getCanvasAssignmentInfo,
  makeFileFetcher,
  generateSUZinvites,
  sendSuzinviteEmail,
  addInviter,
  doGetConversationPreloadInfo,
  initializeImplicitConversation,
  buildConversationDemoUrl,
  buildModerationUrl,
  buildSeedUrl,
  sendImplicitConversationCreatedEmails,
  hasAuthToken,
  browserSupportsPushState,
  addStaticFileHeaders,
  proxy,
  HMAC_SIGNATURE_PARAM_NAME,
  fetchIndexForReportPage,
  fetchIndexForAdminPage,
};
