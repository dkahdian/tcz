#!/bin/bash
set -euo pipefail

mapfile -t META < <(node <<'EOF'
const payload = require('./contribution.json');
const contributor = payload.contributor || {};
const fields = [
	contributor.email || 'anonymous',
	contributor.github || '',
	contributor.note || '',
	payload.submissionId || ''
];
for (const value of fields) {
	console.log(String(value));
}
EOF
)

CONTRIBUTOR_EMAIL=${META[0]}
CONTRIBUTOR_GITHUB=${META[1]}
CONTRIBUTOR_NOTE=${META[2]}
SUBMISSION_ID=${META[3]}

CONTRIBUTOR_GITHUB=${CONTRIBUTOR_GITHUB#@}

REPOSITORY=${GITHUB_REPOSITORY:-}
if [[ -z "$REPOSITORY" ]]; then
	REPOSITORY=$(git config --get remote.origin.url | sed -E 's#(git@|https://)github.com[:/](.+)\.git#\2#')
fi
if [[ -z "$REPOSITORY" ]]; then
	echo "Unable to determine repository for PR creation" >&2
	exit 1
fi


sanitize_slug() {
	local raw="$1"
	local cleaned
	cleaned=$(echo "$raw" | tr -c '[:alnum:]._ -' '-')
	cleaned=${cleaned// /-}
	cleaned=${cleaned//--/-}
	cleaned=${cleaned#-}
	cleaned=${cleaned%-}
	if [[ -z "$cleaned" ]]; then
		cleaned=$(date +%s)
	fi
	printf '%s' "$cleaned"
}

RAW_SLUG=${SUBMISSION_ID:-$(date +%s)}
BRANCH_SLUG=$(sanitize_slug "$RAW_SLUG")
BRANCH_NAME="contribution/${BRANCH_SLUG}"

declare -a LABELS=("data-contribution" "needs-review")

if git rev-parse --verify "$BRANCH_NAME" >/dev/null 2>&1; then
	git checkout "$BRANCH_NAME"
else
	git checkout -b "$BRANCH_NAME"
fi

git config user.name "bot"
git config user.email "b@o.t"

git add src/lib/data/

if git diff --cached --quiet; then
	echo "ERROR: No files were modified by the contribution generation script."
	cat contribution.json
	exit 1
fi

COMMIT_MSG="Data contribution ${BRANCH_SLUG}"
if [[ -n "$CONTRIBUTOR_GITHUB" ]]; then
	COMMIT_MSG+=" (by @${CONTRIBUTOR_GITHUB})"
fi

git commit -m "$COMMIT_MSG"

git push origin "$BRANCH_NAME"

PR_TITLE="Data contribution ${BRANCH_SLUG}"
if [[ -n "$CONTRIBUTOR_GITHUB" ]]; then
	PR_TITLE+=" (by @${CONTRIBUTOR_GITHUB})"
fi

export GH_TOKEN=${GH_TOKEN:-$CONTRIBUTION_TOKEN}

PR_BODY_FILE=$(mktemp)
cat > "$PR_BODY_FILE" <<EOF
## Submission Details

- Submission ID: ${SUBMISSION_ID:-${BRANCH_SLUG}}
- Contributor Email: ${CONTRIBUTOR_EMAIL}
EOF

if [[ -n "$CONTRIBUTOR_GITHUB" ]]; then
	echo "- GitHub: @${CONTRIBUTOR_GITHUB}" >> "$PR_BODY_FILE"
fi

if [[ -n "$CONTRIBUTOR_NOTE" ]]; then
	cat >> "$PR_BODY_FILE" <<EOF

### Contributor Note
${CONTRIBUTOR_NOTE}
EOF
fi

cat >> "$PR_BODY_FILE" <<EOF

## Automation

This PR was generated from sandbox-mode contribution edits. Validation and build checks already ran in the workflow before opening this pull request.

*This PR was automatically generated from a community contribution.*
EOF

CREATE_STDOUT=$(mktemp)
CREATE_STDERR=$(mktemp)
if gh pr create \
	--repo "$REPOSITORY" \
	--base main \
	--head "$BRANCH_NAME" \
	--title "$PR_TITLE" \
	--body-file "$PR_BODY_FILE" \
	>"$CREATE_STDOUT" 2>"$CREATE_STDERR"; then
	echo "Opened PR for ${BRANCH_NAME}"
else
	if grep -qi "already exists" "$CREATE_STDERR"; then
		printf "Reusing existing PR for %s\n" "$BRANCH_NAME"
	else
		cat "$CREATE_STDERR" >&2
		rm "$CREATE_STDOUT" "$CREATE_STDERR" "$PR_BODY_FILE"
		exit 1
	fi
fi

REPO_OWNER=${REPOSITORY%%/*}
REPO_NAME=${REPOSITORY#*/}

PR_RESPONSE=""
PR_URL_FROM_OUTPUT=$(grep -Eo "https://github.com/${REPOSITORY}/pull/[0-9]+" "$CREATE_STDOUT" | tail -n 1 || true)

if [[ -n "$PR_URL_FROM_OUTPUT" ]]; then
	NEW_PR_NUMBER=${PR_URL_FROM_OUTPUT##*/}
	NEW_PR_URL=$PR_URL_FROM_OUTPUT
fi

if [[ -z "${NEW_PR_NUMBER:-}" ]]; then
	PR_RESPONSE=$(gh api graphql \
		-f owner="$REPO_OWNER" \
		-f name="$REPO_NAME" \
		-f headRef="$BRANCH_NAME" \
		-f query='query($owner: String!, $name: String!, $headRef: String!) {
			repository(owner: $owner, name: $name) {
				pullRequests(headRefName: $headRef, last: 1, states: [OPEN, MERGED, CLOSED]) {
					nodes { number url }
				}
			}
		}' \
		--jq '.data.repository.pullRequests.nodes[0]' 2>/dev/null || true)

	NEW_PR_NUMBER=$(echo "$PR_RESPONSE" | jq '.number // empty')
	NEW_PR_URL=$(echo "$PR_RESPONSE" | jq -r '.url // empty')
fi

if [[ -z "$NEW_PR_NUMBER" ]]; then
	echo "Unable to locate PR metadata for branch ${BRANCH_NAME}" >&2
	exit 1
fi

if [[ -z "$NEW_PR_URL" ]]; then
	NEW_PR_URL="https://github.com/${REPOSITORY}/pull/${NEW_PR_NUMBER}"
fi

rm "$CREATE_STDOUT" "$CREATE_STDERR" "$PR_BODY_FILE"

for label in "${LABELS[@]}"; do
	LABEL_PAYLOAD=$(jq -n --arg label "$label" '{labels: [$label]}')
	printf '%s' "$LABEL_PAYLOAD" | gh api "repos/${REPOSITORY}/issues/${NEW_PR_NUMBER}/labels" --method POST --input - >/dev/null || \
		echo "Note: Label '$label' not found, skipping"
done
