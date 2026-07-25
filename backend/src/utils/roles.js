// Four authority levels, lowest to highest. Keep this list and its order
// as the single source of truth — everything else (schema CHECK constraint,
// JWT claims, route guards) derives from it.
const ROLES = ['user', 'officer', 'executive', 'admin'];

const RANK = Object.fromEntries(ROLES.map((role, i) => [role, i]));

function isValidRole(role) {
  return ROLES.includes(role);
}

/** True if `role` is at least as senior as `threshold` (e.g. officer+). */
function isAtLeast(role, threshold) {
  return (RANK[role] ?? -1) >= (RANK[threshold] ?? Infinity);
}

module.exports = { ROLES, RANK, isValidRole, isAtLeast };
