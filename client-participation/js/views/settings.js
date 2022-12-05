var PolisModelView = require("../lib/PolisModelView");
var template = require("../templates/settings.handlebars");

module.exports = PolisModelView.extend({
  name: "settings",
  template: template,
  context: function() {
    var ctx = PolisModelView.prototype.context.apply(this, arguments);
    ctx.hasMultipleSites = this.model.get("site_ids").length > 1;
    return ctx;
  },
  initialize: function(options) {
    this.model = options.model;
  },
  events: {
    "click #addSite": function() {
      $.get("/api/v3/dummyButton?button=addAnotherSiteIdFromSettings");
      alert("coming soon");
    }
  }
});
