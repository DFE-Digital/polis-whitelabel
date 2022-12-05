var path = require("path");

module.exports = {
  entry: ["./src/index"],
  output: {
    path: path.join(__dirname, "devel"),
    filename: "admin_bundle.js",
    publicPath: "/dist/",
  },
  resolve: {
    extensions: [".js", ".css", ".png", ".svg"],
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        loaders: ["babel-loader"],
        include: path.join(__dirname, "src"),
      },

      {
        test: /\.(png|jpg|gif|svg)$/,
        loader: "file-loader",
      },
      {
        test: /\.mdx?$/,
        use: ['babel-loader', '@mdx-js/loader']
      }
    ],
  },
};
