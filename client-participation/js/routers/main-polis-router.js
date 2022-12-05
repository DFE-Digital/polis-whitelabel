var $ = require("jquery");
var _ = require("lodash");
var Backbone = require("backbone");
var bbFetch = require("../net/bbFetch");
var ConversationModel = require("../models/conversation");
var eb = require("../eventBus");
var ParticipantModel = require("../models/participant");
var ParticipationView = require("../views/participation");
var PolisStorage = require("../util/polisStorage");
var preloadHelper = require("../util/preloadHelper");
var RootView = require("../views/root");
var SettingsView = require("../views/settings.js");

var UserModel = require("../models/user");
var Utils = require("../util/utils");
var hasEmail = require("../util/polisStorage").hasEmail;


var match = window.location.pathname.match(/ep1_[0-9A-Za-z]+$/);
var encodedParams = match ? match[0] : void 0;

function onFirstRender() {
  $("#mainSpinner").hide();
}

function authenticated() {
  return PolisStorage.uid() || PolisStorage.uidFromCookie() || window.authenticatedByHeader;
}

var polisRouter = Backbone.Router.extend({
  gotoRoute: function(route, options) {
    window.location = route;
  },
  initialize: function(options) {
    this.r(/^conversation\/create(\/ep1_[0-9A-Za-z]+)?/, "createConversation");
    this.r("user/create(/:params)", "createUser");
    this.r(/^user\/logout(\/.+)/, "deregister");
    this.r("welcome/:einvite", "createUserViewFromEinvite");
    this.r("", "landingPageView");

    this.r(/^([0-9][0-9A-Za-z]+)\/?(\?.*)?$/, "participationViewWithQueryParams"); // conversation_id / query params
    this.r(/^([0-9][0-9A-Za-z]+)(\/ep1_[0-9A-Za-z]+)?$/, "participationView"); // conversation_id / encodedStringifiedJson
    this.r(/^ot\/([0-9][0-9A-Za-z]+)\/(.*)/, "participationViewWithSuzinvite"); // ot/conversation_id/suzinvite
    this.r(/^demo\/([0-9][0-9A-Za-z]+)/, "demoConversation");

    this.r(/^settings(\/ep1_[0-9A-Za-z]+)?/, "settings");

    eb.once(eb.firstRender, function() {
      onFirstRender();
    });

  }, // end initialize
  r: function(pattern, methodNameToCall) {
    var that = this;
    this.route(pattern, function() {
      that[methodNameToCall].apply(that, arguments);
    });
  },
  bail: function() {
    this.gotoRoute("/", {
      trigger: true
    });
  },

  landingPageView: function() {
    console.log('landingPageView');
    if (!authenticated()) {
      console.log('!authenticated');
      this.gotoRoute("/user/create", {
        trigger: true
      });
    } else {
      this.gotoRoute("/inbox", {
        trigger: true
      });
    }
  },

  settings: function(encodedStringifiedJson) {
    var promise = $.Deferred().resolve();
    if (!authenticated()) {
      promise = this.doLogin(false);
    } else if (!hasEmail()  && !window.authenticatedByHeader) {
      promise = this.doLogin(true);
    }
    promise.then(function() {
      var userModel = new UserModel();
      bbFetch(userModel).then(function() {
          var v = new SettingsView({
            model: userModel,
          });
          RootView.getInstance().setView(v);
        });
    });
  },

  deregister: function(dest) {
    window.deregister(dest);
  },
  doLaunchConversation2: function(conversation_id, args) {
    // Since nextComment is pretty slow, fire off the request way early (this
    // actually happens on the js on index.html now) and pass the promise into
    // the participation view so it's (probably) ready when the page loads.
    var firstCommentPromise = preloadHelper.firstCommentPromise;

    this.getConversationModel(conversation_id).then(function(model) {

      if (!_.isUndefined(args.vis_type)) {
        // allow turning on the vis from the URL.
        if (model.get("is_mod")) {
          model.set("vis_type", Number(args.vis_type));
        }
      }
      var participationView = new ParticipationView({
        wipCommentFormText: args.wipCommentFormText,
        model: model,
        finishedTutorial: userObject.finishedTutorial,
        firstCommentPromise: firstCommentPromise
      });
      RootView.getInstance().setView(participationView);
    }, function(e) {
      console.error("error3 loading conversation model");
    });
  },

  doLaunchConversation: function(args) {
    var ptptModel = args.ptptModel;
    var conversation_id = ptptModel.get("conversation_id");

    // Since nextComment is pretty slow, fire off the request way early and pass
    // the promise into the participation view so it's (probably) ready when the
    // page loads.
    var firstCommentPromise = $.get("/api/v3/nextComment?not_voted_by_pid=mypid&limit=1&include_social=true&conversation_id=" + conversation_id);

    this.getConversationModel(conversation_id).then(function(model) {

      if (!_.isUndefined(args.vis_type)) {
        // allow turning on the vis from the URL.
        if (model.get("is_mod")) {
          model.set("vis_type", Number(args.vis_type));
        }
      }
      var participationView = new ParticipationView({
        wipCommentFormText: args.wipCommentFormText,
        model: model,
        ptptModel: ptptModel,
        finishedTutorial: userObject.finishedTutorial,
        firstCommentPromise: firstCommentPromise
      });
      RootView.getInstance().setView(participationView);
    }, function(e) {
      console.error("error3 loading conversation model");
    });
  },

  demoConversation: function(conversation_id) {
    var ptpt = new ParticipantModel({
      conversation_id: conversation_id,
      pid: -123 // DEMO_MODE
    });

    // NOTE: not posting the model

    this.doLaunchConversation({
      ptptModel: ptpt
    });
  },
  participationViewWithSuzinvite: function(conversation_id, suzinvite) {
    window.suzinvite = suzinvite;
    return this.participationView(conversation_id, null, suzinvite);
  },
  participationView: function(conversation_id, encodedStringifiedJson, suzinvite) {
    var params = {};
    if (encodedStringifiedJson) {
      encodedStringifiedJson = encodedStringifiedJson.slice(1);
      params = Utils.decodeParams(encodedStringifiedJson);
    }
    this.doLaunchConversation2(conversation_id, params);
  },
  participationViewWithQueryParams: function(conversation_id, queryParamString) {
    var params = Utils.parseQueryParams(queryParamString);
    this.doLaunchConversation2(conversation_id, params);
  },
  getConversationModel: function(conversation_id, suzinvite) {
    var model;
    if (window.preloadData && window.preloadData.conversation && !suzinvite) {
      model = new ConversationModel(preloadData);
      return Promise.resolve(model);
    }
    // no preloadData copy of the conversation model, so make an ajax request for it.
    return preloadHelper.firstConvPromise.then(function(conv) {
      model = new ConversationModel(conv);
      if (suzinvite) {
        model.set("suzinvite", suzinvite);
      }
      return model;
    });
  },

  redirect: function(path, ignoreEncodedParams) {
    console.log('redirecting to', path);
    var ep = (encodedParams ? ("/" + encodedParams) : "");
    if (ignoreEncodedParams) {
      ep = "";
    }
    document.location = document.location.protocol + "//" + document.location.host + path + ep;
  }

});

module.exports = polisRouter;
