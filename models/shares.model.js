/**
 * Initialize User definition
 *
 * @param sequelize DataTypes Instance
 * @returns {SharesClass} Returns the Users model
 */

/* istanbul ignore next */
module.exports = function( sequelize, DataTypes ) {
  return sequelize.define(
    'shares', {
      pool: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      block_type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      share: {
        type: DataTypes.JSONB,
        allowNull: false,
      },
      share_type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      ip_hash: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      ip_hint: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    });
};
