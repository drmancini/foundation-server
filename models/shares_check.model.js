/**
 * Initialize User definition
 *
 * @param sequelize DataTypes Instance
 * @returns {SharesClass} Returns the Users model
 */

/* istanbul ignore next */
module.exports = function( sequelize, DataTypes ) {
  return sequelize.define(
    'shares-check', {
      pool: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      block_valid: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      share: {
        type: DataTypes.JSONB,
        allowNull: false,
      },
      share_type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
    });
};
