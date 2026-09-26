Feature: Persistent direct execution history
  Scenario: Completed direct response survives a fresh history request
    Given an enabled provider returning a response
    When I execute a direct instruction
    Then the history contains the verified response

  Scenario: Provider failure is saved without private diagnostic details
    Given an enabled provider failing authentication
    When I execute a direct instruction
    Then the history contains a safe failed outcome

  Scenario: Simulation history does not claim a verified connection
    Given an explicit simulation
    When I execute a direct instruction
    Then the history contains an unverified simulated response
