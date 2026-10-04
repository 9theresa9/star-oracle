CREATE INDEX user_createdAt_idx ON user(createdAt);
CREATE INDEX reading_createdAt_kind_idx ON reading(createdAt,kind);
CREATE INDEX daily_entry_date_idx ON daily_entry(date);
CREATE INDEX action_plan_userId_completedAt_idx ON action_plan(userId,completedAt);
CREATE INDEX redemption_userId_createdAt_idx ON redemption(userId,createdAt);
