.PHONY: help setup build typecheck test verify package publish publish-rc publish-dry clean clean-dist check-version update-deps

help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-18s %s\n", $$1, $$2}'

setup: ## Install dependencies and prepare project
	@echo "Installing dependencies..."
	npm install
	@echo "Setup complete"

build: ## Build for production (tsc -> dist: ESM + .d.ts)
	@echo "Building for production..."
	npm run build
	@echo "Build complete - Files in ./dist"

typecheck: ## Type-check without emitting
	npm run typecheck

test: ## Run the unit test suite (vitest)
	npm test

verify: ## Type-check + run the unit tests (the pre-publish gate)
	@echo "Verifying: typecheck + tests..."
	npm run typecheck
	npm test
	@echo "Verify complete"

package: build ## Create npm package (tarball)
	@echo "Creating package..."
	npm pack
	@echo "Package created - see above for details"

publish-dry: ## Publish to npm (dry run) - cleans dist first
	@echo "Running publish dry-run..."
	npm run clean:dist
	npm run build
	npm publish --dry-run
	@echo "Dry-run complete - Review the output above"

# This core is depended on by web-multiselect / web-daterangepicker / web-treeview,
# so publish and publish-rc run the full verify (typecheck + tests) before shipping.
publish: ## Publish to npm as 'latest' - verifies, then cleans + builds (use for release/patch/minor/major)
	@echo "WARNING: This will publish @keenmate/web-components-core to npm as the 'latest' dist-tag"
	@echo "Use 'make publish-rc' instead if you're shipping a pre-release version."
	@echo "Press Ctrl+C to cancel, or Enter to continue..."
	@powershell -Command "Read-Host | Out-Null"
	@echo "Verifying before publish..."
	npm run typecheck
	npm test
	@echo "Publishing to npm..."
	npm run clean:dist
	npm run build
	npm publish
	@echo "Published successfully"

publish-rc: ## Publish to npm under the 'rc' dist-tag (does NOT touch 'latest')
	@echo "WARNING: This will publish @keenmate/web-components-core to npm under the 'rc' dist-tag"
	@echo "The 'latest' tag will be untouched - consumers must opt in with @rc or @<version>."
	@echo "Press Ctrl+C to cancel, or Enter to continue..."
	@powershell -Command "Read-Host | Out-Null"
	@echo "Verifying before publish..."
	npm run typecheck
	npm test
	@echo "Publishing to npm under 'rc' tag..."
	npm run clean:dist
	npm run build
	npm publish --tag rc
	@echo "Published successfully under 'rc' tag"

clean: ## Clean build artifacts (dist + *.tgz)
	@echo "Cleaning build artifacts..."
	npm run clean
	@echo "Clean complete"

clean-dist: ## Clean only the dist folder
	@echo "Cleaning dist folder..."
	npm run clean:dist
	@echo "Dist cleaned"

check-version: ## Show current package version
	@echo "Current version:"
	@node -p "require('./package.json').version"

update-deps: ## Update dependencies
	@echo "Updating dependencies..."
	npm update
	@echo "Dependencies updated"

# Default target
.DEFAULT_GOAL := help
