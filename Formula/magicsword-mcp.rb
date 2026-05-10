class MagicswordMcp < Formula
  desc "MagicSword MCP server — manage MagicSword conversationally from Claude Desktop, Cursor, etc."
  homepage "https://magicsword.io"
  url "https://registry.npmjs.org/@magicsword-io/magicsword-mcp/-/magicsword-mcp-0.1.0.tgz"
  sha256 "REPLACE_WITH_NPM_TARBALL_SHA256"
  license "Apache-2.0"

  depends_on "node@22"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match "magicsword-mcp", shell_output("#{bin}/magicsword-mcp --version")
  end
end
