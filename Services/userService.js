const User = require("../Models/userModel");

const findAllUsers = async () => {
  return await User.find();
};

const findUserById = async (id) => {
  return await User.findOne({ id });
};

const isEmailTaken = async (email) => !!(await User.findOne({ email }));

const isPhoneTaken = async (phone) => !!(await User.findOne({ phone }));

const isUsernameTaken = async (user_name) => !!(await User.findOne({ user_name }));

module.exports = {
  findAllUsers,
  findUserById,
  isEmailTaken,
  isPhoneTaken,
  isUsernameTaken,
};
