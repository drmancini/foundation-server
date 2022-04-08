/**
 * Initialize User definition
 *
 * @param sequelize DataTypes Instance
 * @returns {SharesClass} Returns the Users model
 */

/* istanbul ignore next */
module.exports = function( sequelize, DataTypes ) {
  return sequelize.define(
    'sharescheck', {
      pool: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      block_type: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      share: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      share_type: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    });
};
