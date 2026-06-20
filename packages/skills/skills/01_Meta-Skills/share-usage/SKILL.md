---
name: "share-usage"
description: "Generate and share anonymized skill usage statistics to help the community understand which skills are most valuable"
review_status: "ai-generated"
version: "1.0.0"
---

# Share Skill Usage Statistics

This skill helps you generate and share anonymized statistics about your skill usage with the community. This helps maintainers understand which skills are most valuable and guides future development.

## When to Use

Use this skill when you want to:
- Share your experience with the skill repository
- Help the community understand which skills are most useful
- Contribute usage data to improve skill development priorities
- Celebrate your research productivity with the community

## What Information Will Be Shared

Before generating the report, you should understand exactly what will be shared:

### ✅ Information That WILL Be Shared

1. **Skill usage counts** - How many times you used each skill
2. **Skill names** - Which skills from this repository you used
3. **Time period** - The date range of your usage data
4. **General statistics** - Total skill calls, unique skills used
5. **Optional context** - Your research domain (if you choose to provide it)

### ❌ Information That Will NOT Be Shared

1. **Your identity** - No usernames, emails, or identifying information
2. **Project details** - No file paths, code, or project names
3. **Conversation content** - No actual research questions or discussions
4. **Timestamps** - Only aggregated date ranges, not specific times
5. **System information** - No machine names, IPs, or system details
6. **Other tools** - Only skills from this repository are counted

## Privacy Notice

**This skill generates a completely anonymized report.** The report contains ONLY:
- Skill names and usage counts
- Date range (e.g., "Last 30 days")
- Optional research domain tag (e.g., "fMRI analysis", "EEG research")

No personally identifiable information, project details, or conversation content is included.

## How to Use

When the user invokes this skill (e.g., "share my skill usage" or "generate usage report"), follow these steps:

### Step 1: Confirm Privacy Understanding

First, present the privacy information to the user and confirm they understand:

**Say to the user:**
> "I'll generate an anonymized report of your skill usage from this repository. The report will include:
>
> ✅ **What WILL be included:**
> - Skill names and usage counts
> - Date range (e.g., "2024-01-01 to 2024-03-01")
> - Optional research domain tag (if you provide it)
> - Optional comments (if you provide them)
>
> ❌ **What will NOT be included:**
> - Your identity (no usernames, emails, names)
> - Project details (no file paths, code, project names)
> - Conversation content (no research questions or discussions)
> - Specific timestamps (only date ranges)
> - System information (no machine names, IPs)
> - Skills from other repositories
>
> The report is completely anonymized and sharing is optional. Shall I proceed?"

Wait for user confirmation before proceeding.

### Step 2: Analyze Claude Code Logs

## Implementation Steps

When this skill is invoked, follow these steps:

### Step 1: Analyze Claude Code Logs

Create a Python script inline to analyze logs:

```python
import json
import re
from pathlib import Path
from collections import Counter
from datetime import datetime

def analyze_usage(claude_dir="~/.claude", days=None):
    """Extract skill usage from Claude Code logs."""
    claude_dir = Path(claude_dir).expanduser()

    all_skills = []
    all_timestamps = []

    # Parse history.jsonl
    history_path = claude_dir / "history.jsonl"
    if history_path.exists():
        with open(history_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                if '"name":"Skill"' in line or '"name": "Skill"' in line:
                    match = re.search(r'"skill":\s*"([^"]+)"', line)
                    if match:
                        skill_name = match.group(1)
                        # Only count skills from this repository
                        if skill_name.startswith('awesome-cognitive-and-neuroscience-skills:'):
                            clean_name = skill_name.replace('awesome-cognitive-and-neuroscience-skills:', '')
                            all_skills.append(clean_name)

                # Extract timestamp
                timestamp_match = re.search(r'"timestamp":(\d+)', line)
                if timestamp_match:
                    ts = int(timestamp_match.group(1)) / 1000
                    all_timestamps.append(datetime.fromtimestamp(ts))

    # Parse debug files
    debug_dir = claude_dir / "debug"
    if debug_dir.exists():
        for debug_file in debug_dir.glob("*.txt"):
            if days:
                file_age = (datetime.now().timestamp() - debug_file.stat().st_mtime) / 86400
                if file_age > days:
                    continue

            with open(debug_file, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
                matches = re.finditer(r'"name":\s*"Skill".*?"skill":\s*"([^"]+)"', content, re.DOTALL)
                for match in matches:
                    skill_name = match.group(1)
                    if skill_name.startswith('awesome-cognitive-and-neuroscience-skills:'):
                        clean_name = skill_name.replace('awesome-cognitive-and-neuroscience-skills:', '')
                        all_skills.append(clean_name)

    if not all_skills:
        return None

    # Calculate statistics
    skill_counts = Counter(all_skills)

    if all_timestamps:
        min_date = min(all_timestamps)
        max_date = max(all_timestamps)
        date_range = f"{min_date.strftime('%Y-%m-%d')} to {max_date.strftime('%Y-%m-%d')}"
        days_span = (max_date - min_date).days
    else:
        date_range = "Unknown"
        days_span = None

    return {
        'skills': skill_counts,
        'total_calls': len(all_skills),
        'unique_skills': len(skill_counts),
        'date_range': date_range,
        'days_span': days_span,
        'most_used': skill_counts.most_common(1)[0] if skill_counts else None
    }
```

### Step 3: Ask User for Optional Information

Use the AskUserQuestion tool to gather optional information:

**Question 1: Research Domain**
- Header: "Domain"
- Question: "What research domain do you work in? (This helps others find relevant skills)"
- Options:
  - "fMRI analysis"
  - "EEG/MEG research"
  - "Cognitive modeling"
  - "Behavioral experiments"
  - "Other (specify in notes)"

**Question 2: Comments**
- Header: "Experience"
- Question: "Would you like to add comments about your experience with these skills?"
- Options:
  - "Yes, I'll add comments"
  - "No comments"

**Question 3: Sharing Preference**
- Header: "Action"
- Question: "What would you like to do with the report?"
- Options:
  - "Share to GitHub Discussions (Recommended)"
  - "Save locally only"
  - "Just preview, don't save"

If user chose "Yes" for comments, ask them to provide their comments in a follow-up message.

### Step 4: Generate Report

### Step 4: Generate Report

Create the markdown report with this exact format:

```markdown
# Skill Usage Report

**Time Period**: [date_range] ([days_span] days)
**Research Domain**: [user_provided or "Not specified"]

## Summary
- Total skill calls: [total_calls]
- Unique skills used: [unique_skills]
- Most used skill: [skill_name] ([count] times)

## Top 10 Skills
1. [skill]: [count] uses
2. [skill]: [count] uses
...

## All Skills Used
- [skill]: [count]
- [skill]: [count]
...

## User Comments
[user_comments or "No comments provided"]

---
*This report was generated using the `share-usage` skill. All data is anonymized.*
```

### Step 5: Check GitHub CLI Prerequisites

Before offering to share, check if `gh` CLI is available:

```bash
gh auth status
```

If `gh` is not installed or not authenticated, inform the user:
> To share usage reports directly, you need the GitHub CLI. Install it from https://cli.github.com/ and run `gh auth login`.
> I can save the report locally for you to post manually, or you can set up `gh` and run this skill again.

### Step 6: Save and Present

1. **Save the report** to the current working directory as `skill-usage-report-[YYYYMMDD].md`

2. **Display the report** to the user in full

3. **Provide next steps** based on user's preference:

   - If "Share to GitHub Discussions" (and `gh` is available):

     Get repository and category IDs:
     ```bash
     gh api graphql -f query='
     {
       repository(owner: "HaoxuanLiTHUAI", name: "awesome_cognitive_and_neuroscience_skills") {
         id
         discussionCategories(first: 10) {
           nodes {
             id
             name
           }
         }
       }
     }'
     ```

     Create the discussion:
     ```bash
     gh api graphql -f query='
     mutation {
       createDiscussion(input: {
         repositoryId: "REPO_ID",
         categoryId: "SHOW_AND_TELL_CATEGORY_ID",
         title: "Skill Usage Report - [Research Domain]",
         body: "REPORT_CONTENT_HERE"
       }) {
         discussion {
           url
         }
       }
     }'
     ```

     On success:
     ```
     ✅ Report saved to: skill-usage-report-[date].md
     🎉 Shared to GitHub Discussions: [URL]

     Thank you for contributing to the community!
     ```

     On failure:
     ```
     ✅ Report saved to: skill-usage-report-[date].md
     ❌ Failed to post to GitHub Discussions

     You can manually share at:
     https://github.com/HaoxuanLiTHUAI/awesome_cognitive_and_neuroscience_skills/discussions/new?category=show-and-tell
     ```

   - If "Save locally only":
     ```
     ✅ Report saved to: skill-usage-report-[date].md

     Your report is saved locally. Sharing is completely optional - you can share it later if you'd like!
     ```

   - If "Just preview, don't save":
     ```
     📊 Here's your usage report (not saved):

     [Display report]

     If you'd like to save or share this later, just run this skill again!
     ```

### Step 7: Handle Edge Cases

**If no skill usage found:**
```
❌ No skill usage found from this repository.

This could mean:
- You haven't used any skills from awesome-cognitive-and-neuroscience-skills yet
- The Claude Code logs don't contain skill usage data
- The log format may have changed

Try using some skills first, then run this report again!
```

**If Claude directory not found:**
```
❌ Could not find Claude Code directory at ~/.claude/

Please check your Claude Code installation or specify a different directory.
```

## Example Report

Here's what a typical usage report looks like:

```markdown
# Skill Usage Report

**Time Period**: 2024-01-15 to 2024-03-03 (48 days)
**Research Domain**: fMRI analysis

## Summary
- Total skill calls: 47
- Unique skills used: 12
- Most used skill: fmri-glm-analysis-guide (15 times)

## Top 10 Skills
1. fmri-glm-analysis-guide: 15 uses
2. fmri-preprocessing-pipeline-guide: 8 uses
3. cogsci-statistics: 6 uses
4. neuroimaging-power-guide: 4 uses
5. fmri-task-design-guide: 3 uses
6. cogsci-visualization: 3 uses
7. research-literacy: 2 uses
8. cognitive-paradigm-design: 2 uses
9. brain-connectivity-modeler: 2 uses
10. contribute-skill: 1 use

## All Skills Used
- brain-connectivity-modeler: 2
- cognitive-paradigm-design: 2
- cogsci-statistics: 6
- cogsci-visualization: 3
- contribute-skill: 1
- fmri-glm-analysis-guide: 15
- fmri-preprocessing-pipeline-guide: 8
- fmri-task-design-guide: 3
- neuroimaging-power-guide: 4
- paper-to-skill: 1
- research-literacy: 2
- verify-skill: 1

## User Comments
These skills have been incredibly helpful for my fMRI analysis pipeline. The GLM analysis guide saved me hours of debugging by helping me understand proper contrast specification. The preprocessing guide helped me make informed decisions about motion correction parameters.

---
*This report was generated using the `share-usage` skill. All data is anonymized.*
```

## Important Notes

- **Privacy First**: This skill respects user privacy completely. All data is anonymized.
- **Review Before Sharing**: Users can review and edit the report before sharing.
- **Sharing is Optional**: Sharing is completely voluntary - users can keep reports private.
- **Repository-Specific**: Only skills from this repository are counted (excludes superpowers, scientific-writer, etc.).
- **Community Value**: Reports help maintainers prioritize skill development and help others discover useful skills.
- **No Sensitive Data**: No personal information, project details, or conversation content is included.
