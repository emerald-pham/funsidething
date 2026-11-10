// Loading this module removes git's repository-locating variables from the test
// process, so every git command a fixture spawns finds its repository from its
// own working directory. A test run with GIT_DIR set moved the real branch and
// HEAD through fixtures that inherited it (#2292). Test files only: release,
// hook and agent tools must keep honouring git's environment.
//
// The list is the part of `git rev-parse --local-env-vars` that says where a
// repository, its work tree, index or objects are.
for (const variable of [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_GRAFT_FILE',
  'GIT_SHALLOW_FILE',
  'GIT_PREFIX',
]) delete process.env[variable];
