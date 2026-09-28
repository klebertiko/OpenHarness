Feature: Slash menu — commands, skills and tools are distinct and honest
  Contract: contract.md §1, §2.1, §2.2. Owner FE: Claude (Vitest + Playwright). Owner BE for discover/capabilities: Codex.

  Background:
    Given the workspace "Development" is selected in the composer

  Scenario: Discover lists skills and npm scripts with kinds
    Given the workspace contains ".claude/skills/harness/SKILL.md" and "frontend/package.json" with script "test"
    When I GET /chat/tools/discover
    Then items include kind "skill" name "harness" source "claude-skills"
    And items include kind "command" name "test" argv ["npm", "run", "test"] source "package-scripts"
    And no item carries file content

  Scenario: Discover ignores heavy directories and caps items
    Given the workspace contains 600 package.json files under "node_modules"
    When I GET /chat/tools/discover
    Then items has at most 500 entries
    And no item path starts with "node_modules"

  Scenario: Typing slash shows Command, Skill and Tool sections
    When I type "/" in the composer
    Then the menu shows a "Command" item "new"
    And the menu shows a "Skill" item "harness" labelled "inserir"
    And the menu shows a "Tool" item "exec"

  Scenario: Selecting a Skill inserts a draft and never executes
    When I select the Skill "harness"
    Then the composer contains the skill text as an editable draft
    And no request was made to /execute/direct

  Scenario: Selecting a Tool starts a run with a preset
    When I select the Tool "test" from package-scripts
    Then a POST to /execute/direct is made with tools.preset argv ["npm", "run", "test"]

  Scenario: Approval card shows argv as a list and waits
    Given a run emitted "tool_approval_required" with argv ["npm", "run", "test"] and risk "normal"
    Then the transcript shows a card listing "npm", "run", "test" on separate lines
    And the card has "Aprovar" and "Rejeitar" buttons
    And the card says "execução local, com os seus privilégios"
    And no control request was sent yet

  Scenario: High-risk approval card is visibly different
    Given a run emitted "tool_approval_required" with risk "high" and risk_hints ["git reset --hard"]
    Then the card shows the label "alto risco" and the hint

  Scenario: Approve sends one control decision for that call
    Given the approval card for call "c1" is visible
    When I click "Aprovar"
    Then a POST to /execute/{run_id}/control is made with action "resume", decision "approve" and call_id "c1"
    And the card state becomes "aprovado"

  Scenario: Tool result states render correctly
    Given a run emitted "tool_result" with ok false and timed_out true
    Then the card shows state "timeout"
    Given a run emitted "tool_result" with truncated true
    Then the card shows a "saída truncada" marker
    Given a run emitted "tool_denied" with reason "rejected"
    Then the card shows state "rejeitado"

  Scenario: No workspace hides tools and says why
    Given no workspace is selected
    When I type "/" in the composer
    Then the menu shows no "Tool" items
    And the menu shows the note "Selecione uma pasta para usar ferramentas"

  Scenario: CLI provider shows honest capabilities
    Given the selected connection uses a CLI adapter
    When a run emits "capabilities" with reason "cli-adapter"
    Then the transcript shows "este provedor não pede ferramentas; /exec e /read continuam disponíveis"

  Scenario: First read on a remote provider discloses where content goes
    Given the selected connection is "openrouter"
    When the first "tool_result" for read arrives in this session
    Then the transcript shows "arquivos lidos são enviados a openrouter"

  Scenario: Discover also lists agents and codex skills
    Given the workspace contains ".agents/skills/review/SKILL.md" and ".codex/skills/deploy/SKILL.md"
    When I GET /chat/tools/discover
    Then items include kind "skill" name "review" source "agents-skills"
    And items include kind "skill" name "deploy" source "codex-skills"
